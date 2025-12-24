import { stringToU8, TRUSTED, u16ToU8, u8ToString, u8ToU16 } from "./lib/util.js";
import Lobby, { validate } from "./lib/Lobby.js";
import logToWebhook from "./lib/webhookLogger.js";
import { getUUIDData, standardGetUUID } from "./lib/uuid.js";
import { analytics, AnalyticsEntry } from "./lib/analytics.js";

if (Bun.env.ENV_DONE !== "true") {
    const trustedKey = Array.from(crypto.getRandomValues(new Uint8Array(24))).map(e => e.toString(16).padStart(2, "0")).join("");
    await Bun.write("./.env", `ENV_DONE=false\nTRUSTED_admin=${trustedKey}\nADMIN_admin=devkey\nLOG_NAME=development\nPORT=80\nTLS_DIRECTORY=false`);
    console.warn("Please fill out the .env file with the correct values. Set ENV_DONE to 'true' when done.");
    process.exit();
}

let connectionID = 0;
const SOCKET_TYPE_LOBBY = 0;
const SOCKET_TYPE_CLIENT = 1;

const IP_TABLES = {};
const UUID_RATE_LIMITS = {};
const IP_LIMIT = 100;

const patterns = [
    /\b([sŚśṤṥŜŝŠšṦṧṠṡŞşṢṣṨṩȘșS̩s̩ꞨꞩⱾȿꟅʂᶊᵴ][a4ÁáÀàĂăẮắẰằẴẵẲẳÂâẤấẦầẪẫẨẩǍǎÅåǺǻÄäǞǟÃãȦȧǠǡĄąĄ́ą́Ą̃ą̃ĀāĀ̀ā̀ẢảȀȁA̋a̋ȂȃẠạẶặẬậḀḁȺⱥꞺꞻᶏẚＡａ][nŃńǸǹŇňÑñṄṅŅņṆṇṊṋṈṉN̈n̈ƝɲŊŋꞐꞑꞤꞥᵰᶇɳȵꬻꬼИиПпＮｎ][dĎďḊḋḐḑD̦d̦ḌḍḒḓḎḏĐđÐðƉɖƊɗᵭᶁᶑȡ])*[nŃńǸǹŇňÑñṄṅŅņṆṇṊṋṈṉN̈n̈ƝɲŊŋꞐꞑꞤꞥᵰᶇɳȵꬻꬼИиПпＮｎ]+[iÍíi̇́Ììi̇̀ĬĭÎîǏǐÏïḮḯĨĩi̇̃ĮįĮ́į̇́Į̃į̇̃ĪīĪ̀ī̀ỈỉȈȉI̋i̋ȊȋỊịꞼꞽḬḭƗɨᶖİiIıＩｉ1lĺľļḷḹl̃ḽḻłŀƚꝉⱡɫɬꞎꬷꬸꬹᶅɭȴＬｌoÓóÒòŎŏÔôỐốỒồỖỗỔổǑǒÖöȪȫŐőÕõṌṍṎṏȬȭȮȯO͘o͘ȰȱØøǾǿǪǫǬǭŌōṒṓṐṑỎỏȌȍȎȏƠơỚớỜờỠỡỞởỢợỌọỘộO̩o̩Ò̩ò̩Ó̩ó̩ƟɵꝊꝋꝌꝍⱺＯｏІіa4ÁáÀàĂăẮắẰằẴẵẲẳÂâẤấẦầẪẫẨẩǍǎÅåǺǻÄäǞǟÃãȦȧǠǡĄąĄ́ą́Ą̃ą̃ĀāĀ̀ā̀ẢảȀȁA̋a̋ȂȃẠạẶặẬậḀḁȺⱥꞺꞻᶏẚＡａ]*[gǴǵĞğĜĝǦǧĠġG̃g̃ĢģḠḡǤǥꞠꞡƓɠᶃꬶＧｇqꝖꝗꝘꝙɋʠ]+(l[e3ЄєЕеÉéÈèĔĕÊêẾếỀềỄễỂểÊ̄ê̄Ê̌ê̌ĚěËëẼẽĖėĖ́ė́Ė̃ė̃ȨȩḜḝĘęĘ́ę́Ę̃ę̃ĒēḖḗḔḕẺẻȄȅE̋e̋ȆȇẸẹỆệḘḙḚḛɆɇE̩e̩È̩è̩É̩é̩ᶒⱸꬴꬳＥｅ]+t+|[e3ЄєЕеÉéÈèĔĕÊêẾếỀềỄễỂểÊ̄ê̄Ê̌ê̌ĚěËëẼẽĖėĖ́ė́Ė̃ė̃ȨȩḜḝĘęĘ́ę́Ę̃ę̃ĒēḖḗḔḕẺẻȄȅE̋e̋ȆȇẸẹỆệḘḙḚḛɆɇE̩e̩È̩è̩É̩é̩ᶒⱸꬴꬳＥｅa4ÁáÀàĂăẮắẰằẴẵẲẳÂâẤấẦầẪẫẨẩǍǎÅåǺǻÄäǞǟÃãȦȧǠǡĄąĄ́ą́Ą̃ą̃ĀāĀ̀ā̀ẢảȀȁA̋a̋ȂȃẠạẶặẬậḀḁȺⱥꞺꞻᶏẚＡａ]*[rŔŕŘřṘṙŖŗȐȑȒȓṚṛṜṝṞṟR̃r̃ɌɍꞦꞧⱤɽᵲᶉꭉ]*|n[ÓóÒòŎŏÔôỐốỒồỖỗỔổǑǒÖöȪȫŐőÕõṌṍṎṏȬȭȮȯO͘o͘ȰȱØøǾǿǪǫǬǭŌōṒṓṐṑỎỏȌȍȎȏƠơỚớỜờỠỡỞởỢợỌọỘộO̩o̩Ò̩ò̩Ó̩ó̩ƟɵꝊꝋꝌꝍⱺＯｏ0]+[gǴǵĞğĜĝǦǧĠġG̃g̃ĢģḠḡǤǥꞠꞡƓɠᶃꬶＧｇqꝖꝗꝘꝙɋʠ]+|[a4ÁáÀàĂăẮắẰằẴẵẲẳÂâẤấẦầẪẫẨẩǍǎÅåǺǻÄäǞǟÃãȦȧǠǡĄąĄ́ą́Ą̃ą̃ĀāĀ̀ā̀ẢảȀȁA̋a̋ȂȃẠạẶặẬậḀḁȺⱥꞺꞻᶏẚＡａ]*)*[sŚśṤṥŜŝŠšṦṧṠṡŞşṢṣṨṩȘșS̩s̩ꞨꞩⱾȿꟅʂᶊᵴ]*\b/,
    /[fḞḟƑƒꞘꞙᵮᶂ]+[aÁáÀàĂăẮắẰằẴẵẲẳÂâẤấẦầẪẫẨẩǍǎÅåǺǻÄäǞǟÃãȦȧǠǡĄąĄ́ą́Ą̃ą̃ĀāĀ̀ā̀ẢảȀȁA̋a̋ȂȃẠạẶặẬậḀḁȺⱥꞺꞻᶏẚＡａ@4]+[gǴǵĞğĜĝǦǧĠġG̃g̃ĢģḠḡǤǥꞠꞡƓɠᶃꬶＧｇqꝖꝗꝘꝙɋʠ]+([ÓóÒòŎŏÔôỐốỒồỖỗỔổǑǒÖöȪȫŐőÕõṌṍṎṏȬȭȮȯO͘o͘ȰȱØøǾǿǪǫǬǭŌōṒṓṐṑỎỏȌȍȎȏƠơỚớỜờỠỡỞởỢợỌọỘộO̩o̩Ò̩ò̩Ó̩ó̩ƟɵꝊꝋꝌꝍⱺＯｏ0e3ЄєЕеÉéÈèĔĕÊêẾếỀềỄễỂểÊ̄ê̄Ê̌ê̌ĚěËëẼẽĖėĖ́ė́Ė̃ė̃ȨȩḜḝĘęĘ́ę́Ę̃ę̃ĒēḖḗḔḕẺẻȄȅE̋e̋ȆȇẸẹỆệḘḙḚḛɆɇE̩e̩È̩è̩É̩é̩ᶒⱸꬴꬳＥｅiÍíi̇́Ììi̇̀ĬĭÎîǏǐÏïḮḯĨĩi̇̃ĮįĮ́į̇́Į̃į̇̃ĪīĪ̀ī̀ỈỉȈȉI̋i̋ȊȋỊịꞼꞽḬḭƗɨᶖİiIıＩｉ1lĺľļḷḹl̃ḽḻłŀƚꝉⱡɫɬꞎꬷꬸꬹᶅɭȴＬｌ]+[tŤťṪṫŢţṬṭȚțṰṱṮṯŦŧȾⱦƬƭƮʈT̈ẗᵵƫȶ]+([rŔŕŘřṘṙŖŗȐȑȒȓṚṛṜṝṞṟR̃r̃ɌɍꞦꞧⱤɽᵲᶉꭉ]+[yÝýỲỳŶŷY̊ẙŸÿỸỹẎẏȲȳỶỷỴỵɎɏƳƴỾỿ]+|[rŔŕŘřṘṙŖŗȐȑȒȓṚṛṜṝṞṟR̃r̃ɌɍꞦꞧⱤɽᵲᶉꭉ]+[iÍíi̇́Ììi̇̀ĬĭÎîǏǐÏïḮḯĨĩi̇̃ĮįĮ́į̇́Į̃į̇̃ĪīĪ̀ī̀ỈỉȈȉI̋i̋ȊȋỊịꞼꞽḬḭƗɨᶖİiIıＩｉ1lĺľļḷḹl̃ḽḻłŀƚꝉⱡɫɬꞎꬷꬸꬹᶅɭȴＬｌ]+[e3ЄєЕеÉéÈèĔĕÊêẾếỀềỄễỂểÊ̄ê̄Ê̌ê̌ĚěËëẼẽĖėĖ́ė́Ė̃ė̃ȨȩḜḝĘęĘ́ę́Ę̃ę̃ĒēḖḗḔḕẺẻȄȅE̋e̋ȆȇẸẹỆệḘḙḚḛɆɇE̩e̩È̩è̩É̩é̩ᶒⱸꬴꬳＥｅ]+)?)?[sŚśṤṥŜŝŠšṦṧṠṡŞşṢṣṨṩȘșS̩s̩ꞨꞩⱾȿꟅʂᶊᵴ]*\b/,
    /\b[kḰḱǨǩĶķḲḳḴḵƘƙⱩⱪᶄꝀꝁꝂꝃꝄꝅꞢꞣ]+[iÍíi̇́Ììi̇̀ĬĭÎîǏǐÏïḮḯĨĩi̇̃ĮįĮ́į̇́Į̃į̇̃ĪīĪ̀ī̀ỈỉȈȉI̋i̋ȊȋỊịꞼꞽḬḭƗɨᶖİiIıＩｉ1lĺľļḷḹl̃ḽḻłŀƚꝉⱡɫɬꞎꬷꬸꬹᶅɭȴＬｌyÝýỲỳŶŷY̊ẙŸÿỸỹẎẏȲȳỶỷỴỵɎɏƳƴỾỿ]+[kḰḱǨǩĶķḲḳḴḵƘƙⱩⱪᶄꝀꝁꝂꝃꝄꝅꞢꞣ]+[e3ЄєЕеÉéÈèĔĕÊêẾếỀềỄễỂểÊ̄ê̄Ê̌ê̌ĚěËëẼẽĖėĖ́ė́Ė̃ė̃ȨȩḜḝĘęĘ́ę́Ę̃ę̃ĒēḖḗḔḕẺẻȄȅE̋e̋ȆȇẸẹỆệḘḙḚḛɆɇE̩e̩È̩è̩É̩é̩ᶒⱸꬴꬳＥｅ]([rŔŕŘřṘṙŖŗȐȑȒȓṚṛṜṝṞṟR̃r̃ɌɍꞦꞧⱤɽᵲᶉꭉ]+[yÝýỲỳŶŷY̊ẙŸÿỸỹẎẏȲȳỶỷỴỵɎɏƳƴỾỿ]+|[rŔŕŘřṘṙŖŗȐȑȒȓṚṛṜṝṞṟR̃r̃ɌɍꞦꞧⱤɽᵲᶉꭉ]+[iÍíi̇́Ììi̇̀ĬĭÎîǏǐÏïḮḯĨĩi̇̃ĮįĮ́į̇́Į̃į̇̃ĪīĪ̀ī̀ỈỉȈȉI̋i̋ȊȋỊịꞼꞽḬḭƗɨᶖİiIıＩｉ1lĺľļḷḹl̃ḽḻłŀƚꝉⱡɫɬꞎꬷꬸꬹᶅɭȴＬｌ]+[e3ЄєЕеÉéÈèĔĕÊêẾếỀềỄễỂểÊ̄ê̄Ê̌ê̌ĚěËëẼẽĖėĖ́ė́Ė̃ė̃ȨȩḜḝĘęĘ́ę́Ę̃ę̃ĒēḖḗḔḕẺẻȄȅE̋e̋ȆȇẸẹỆệḘḙḚḛɆɇE̩e̩È̩è̩É̩é̩ᶒⱸꬴꬳＥｅ]+)?[sŚśṤṥŜŝŠšṦṧṠṡŞşṢṣṨṩȘșS̩s̩ꞨꞩⱾȿꟅʂᶊᵴ]*\b/,
    /\b[tŤťṪṫŢţṬṭȚțṰṱṮṯŦŧȾⱦƬƭƮʈT̈ẗᵵƫȶ]+[rŔŕŘřṘṙŖŗȐȑȒȓṚṛṜṝṞṟR̃r̃ɌɍꞦꞧⱤɽᵲᶉꭉ]+([aÁáÀàĂăẮắẰằẴẵẲẳÂâẤấẦầẪẫẨẩǍǎÅåǺǻÄäǞǟÃãȦȧǠǡĄąĄ́ą́Ą̃ą̃ĀāĀ̀ā̀ẢảȀȁA̋a̋ȂȃẠạẶặẬậḀḁȺⱥꞺꞻᶏẚＡａ4]+[nŃńǸǹŇňÑñṄṅŅņṆṇṊṋṈṉN̈n̈ƝɲŊŋꞐꞑꞤꞥᵰᶇɳȵꬻꬼИиПпＮｎ]+([iÍíi̇́Ììi̇̀ĬĭÎîǏǐÏïḮḯĨĩi̇̃ĮįĮ́į̇́Į̃į̇̃ĪīĪ̀ī̀ỈỉȈȉI̋i̋ȊȋỊịꞼꞽḬḭƗɨᶖİiIıＩｉ1lĺľļḷḹl̃ḽḻłŀƚꝉⱡɫɬꞎꬷꬸꬹᶅɭȴＬｌ]+[e3ЄєЕеÉéÈèĔĕÊêẾếỀềỄễỂểÊ̄ê̄Ê̌ê̌ĚěËëẼẽĖėĖ́ė́Ė̃ė̃ȨȩḜḝĘęĘ́ę́Ę̃ę̃ĒēḖḗḔḕẺẻȄȅE̋e̋ȆȇẸẹỆệḘḙḚḛɆɇE̩e̩È̩è̩É̩é̩ᶒⱸꬴꬳＥｅ]+|[yÝýỲỳŶŷY̊ẙŸÿỸỹẎẏȲȳỶỷỴỵɎɏƳƴỾỿ]+|[e3ЄєЕеÉéÈèĔĕÊêẾếỀềỄễỂểÊ̄ê̄Ê̌ê̌ĚěËëẼẽĖėĖ́ė́Ė̃ė̃ȨȩḜḝĘęĘ́ę́Ę̃ę̃ĒēḖḗḔḕẺẻȄȅE̋e̋ȆȇẸẹỆệḘḙḚḛɆɇE̩e̩È̩è̩É̩é̩ᶒⱸꬴꬳＥｅ]+[rŔŕŘřṘṙŖŗȐȑȒȓṚṛṜṝṞṟR̃r̃ɌɍꞦꞧⱤɽᵲᶉꭉ]+|[oÓóÒòŎŏÔôỐốỒồỖỗỔổǑǒÖöȪȫŐőÕõṌṍṎṏȬȭȮȯO͘o͘ȰȱØøǾǿǪǫǬǭŌōṒṓṐṑỎỏȌȍȎȏƠơỚớỜờỠỡỞởỢợỌọỘộO̩o̩Ò̩ò̩Ó̩ó̩ƟɵꝊꝋꝌꝍⱺＯｏ]+[iÍíi̇́Ììi̇̀ĬĭÎîǏǐÏïḮḯĨĩi̇̃ĮįĮ́į̇́Į̃į̇̃ĪīĪ̀ī̀ỈỉȈȉI̋i̋ȊȋỊịꞼꞽḬḭƗɨᶖİiIıＩｉ1lĺľļḷḹl̃ḽḻłŀƚꝉⱡɫɬꞎꬷꬸꬹᶅɭȴＬｌ]+[dĎďḊḋḐḑD̦d̦ḌḍḒḓḎḏĐđÐðƉɖƊɗᵭᶁᶑȡ]+)|[oÓóÒòŎŏÔôỐốỒồỖỗỔổǑǒÖöȪȫŐőÕõṌṍṎṏȬȭȮȯO͘o͘ȰȱØøǾǿǪǫǬǭŌōṒṓṐṑỎỏȌȍȎȏƠơỚớỜờỠỡỞởỢợỌọỘộO̩o̩Ò̩ò̩Ó̩ó̩ƟɵꝊꝋꝌꝍⱺＯｏ]+[iÍíi̇́Ììi̇̀ĬĭÎîǏǐÏïḮḯĨĩi̇̃ĮįĮ́į̇́Į̃į̇̃ĪīĪ̀ī̀ỈỉȈȉI̋i̋ȊȋỊịꞼꞽḬḭƗɨᶖİiIıＩｉ1lĺľļḷḹl̃ḽḻłŀƚꝉⱡɫɬꞎꬷꬸꬹᶅɭȴＬｌ]+[dĎďḊḋḐḑD̦d̦ḌḍḒḓḎḏĐđÐðƉɖƊɗᵭᶁᶑȡ]+)[sŚśṤṥŜŝŠšṦṧṠṡŞşṢṣṨṩȘșS̩s̩ꞨꞩⱾȿꟅʂᶊᵴ]*\b/,
    /\b[cĆćĈĉČčĊċÇçḈḉȻȼꞒꞓꟄꞔƇƈɕ]+[ÓóÒòŎŏÔôỐốỒồỖỗỔổǑǒÖöȪȫŐőÕõṌṍṎṏȬȭȮȯO͘o͘ȰȱØøǾǿǪǫǬǭŌōṒṓṐṑỎỏȌȍȎȏƠơỚớỜờỠỡỞởỢợỌọỘộO̩o̩Ò̩ò̩Ó̩ó̩ƟɵꝊꝋꝌꝍⱺＯｏ0]{2,}[nŃńǸǹŇňÑñṄṅŅņṆṇṊṋṈṉN̈n̈ƝɲŊŋꞐꞑꞤꞥᵰᶇɳȵꬻꬼИиПпＮｎ]+[sŚśṤṥŜŝŠšṦṧṠṡŞşṢṣṨṩȘșS̩s̩ꞨꞩⱾȿꟅʂᶊᵴ]*\b/,
    /\b[cĆćĈĉČčĊċÇçḈḉȻȼꞒꞓꟄꞔƇƈɕ]+[hĤĥȞȟḦḧḢḣḨḩḤḥḪḫH̱ẖĦħⱧⱨꞪɦꞕΗНн]+[iÍíi̇́Ììi̇̀ĬĭÎîǏǐÏïḮḯĨĩi̇̃ĮįĮ́į̇́Į̃į̇̃ĪīĪ̀ī̀ỈỉȈȉI̋i̋ȊȋỊịꞼꞽḬḭƗɨᶖİiIıＩｉ1lĺľļḷḹl̃ḽḻłŀƚꝉⱡɫɬꞎꬷꬸꬹᶅɭȴＬｌ]+[nŃńǸǹŇňÑñṄṅŅņṆṇṊṋṈṉN̈n̈ƝɲŊŋꞐꞑꞤꞥᵰᶇɳȵꬻꬼИиПпＮｎ]+[kḰḱǨǩĶķḲḳḴḵƘƙⱩⱪᶄꝀꝁꝂꝃꝄꝅꞢꞣ]+[sŚśṤṥŜŝŠšṦṧṠṡŞşṢṣṨṩȘșS̩s̩ꞨꞩⱾȿꟅʂᶊᵴ]*\b/
];

const tripsFilter = message => patterns.some(p => p.test(message));

setInterval(() => {
    for (const ip in UUID_RATE_LIMITS) {
        if (UUID_RATE_LIMITS[ip] > 0) {
            UUID_RATE_LIMITS[ip]--;
        }

        if (UUID_RATE_LIMITS[ip] === 0) {
            delete UUID_RATE_LIMITS[ip];
        }
    }
}, 6E4);

function respondServerfetch(request) {
    const requestIP = server.requestIP(request);

    if (requestIP === null) {
        return new Response("Invalid IP", { status: 403 });
    }

    const url = new URL(request.url);
    switch (url.pathname) {
        case "/lobby/list": return Response.json(Lobby.toJSONResponse());
        case "/lobby/get": {
            const id = url.searchParams.get("partyURL");

            if (!id) {
                return Response.json(null);
            }

            const lobby = Lobby.lobbies[id];

            if (!lobby) {
                return Response.json(null);
            }

            return Response.json(lobby.toJSON());
        };
        case "/lobby/resources": {
            const id = url.searchParams.get("partyURL");

            if (!id) {
                return Response.json(null);
            }

            const lobby = Lobby.lobbies[id];

            if (!lobby) {
                return Response.json(null);
            }

            return Response.json(lobby.resources);
        };
        case "/uuid/get": {
            console.log("UUID REQUEST → existing =", url.searchParams.get("existing"), "IP =", requestIP);
            try {
                const ip = requestIP.address;

                if (!ip) {
                    return Response.json({
                        ok: false,
                        error: "Invalid IP"
                    });
                }

                if (UUID_RATE_LIMITS[ip] >= IP_LIMIT) {
                    return Response.json({
                        ok: false,
                        error: "Rate limit exceeded"
                    });
                }

                const searchParams = url.searchParams;
                const existing = searchParams.get("existing");

                if (!existing || (existing !== "false" && existing.length !== 36)) {
                    return Response.json({
                        ok: false,
                        error: "Invalid existing UUID"
                    });
                }

                const data = standardGetUUID(existing, ip);

                if (data.uuid !== existing) {
                    UUID_RATE_LIMITS[ip] = UUID_RATE_LIMITS[ip] ? UUID_RATE_LIMITS[ip] + 1 : 1;
                }

                return Response.json({
                    ok: true,
                    renewed: data.uuid !== existing,
                    ...data
                });

            } catch (e) {
                return Response.json({
                    ok: false,
                    error: `Internal server error: ${e}`
                });
            }
        };
        case "/uuid/check": {
            try {
                const searchParams = url.searchParams;
                const uuid = searchParams.get("uuid");

                if (!uuid || uuid.length !== 36) {
                    return Response.json({
                        ok: false,
                        error: "Invalid UUID"
                    });
                }

                const trustedKey = searchParams.get("trustedKey");

                if (!trustedKey) {
                    return Response.json({
                        ok: false,
                        error: "Invalid trusted key"
                    });
                }

                let valid = false;
                for (const key in TRUSTED) {
                    if (TRUSTED[key] === trustedKey) {
                        valid = true;
                        break;
                    }
                }

                if (!valid) {
                    return Response.json({
                        ok: false,
                        error: "Invalid trusted key"
                    });
                }

                const data = getUUIDData(uuid);
                return Response.json({
                    ok: true,
                    isValid: data !== null,
                    ...data
                });

            } catch (e) {
                return Response.json({
                    ok: false,
                    error: "Internal server error"
                });
            }}
        case "/analytics/get":
            return Response.json(analytics);
        case "/ws/lobby": {
            if (server.upgrade(request, {
                data: {
                    address: requestIP.address,
                    internalID: connectionID++,
                    type: SOCKET_TYPE_LOBBY,
                    url: url,
                    analytics: null
                }
            })) {
                return undefined;
            }

            return new Response("Upgrade Required", { status: 400 });
        };
        case "/ws/client": {
            if (server.upgrade(request, {
                data: {
                    address: requestIP.address,
                    internalID: connectionID++,
                    type: SOCKET_TYPE_CLIENT,
                    url: url,
                    analytics: null
                }
            })) {
                return undefined;
            }

            return new Response("Upgrade Required", { status: 400 });
        };
        default:
            return new Response("Page not found", { status: 404 });
    }
}

const server = Bun.serve({
    fetch(request) {
        const response = respondServerfetch(request);

        if (response) {
            response.headers.set('Access-Control-Allow-Origin', '*');
            response.headers.set('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
        }

        return response;
    },

    websocket: {
        perMessageDeflate: true,
        idleTimeout: 0,  
        sendPings: true,
        open(socket) {
            socket.binaryType = "arraybuffer";

            /** @type {URLSearchParams} */
            const search = socket.data.url.searchParams;

            if (!search.has("analytics")) {
                socket.terminate();
                return;
            }

            try {
                socket.data.analytics = AnalyticsEntry.fromBase64(decodeURIComponent(search.get("analytics")));
            } catch (e) {
                console.log(e);
                socket.terminate();
                return;
            }

            switch (socket.data.type) {
                case SOCKET_TYPE_LOBBY:
                    try {
                        const gameName = search.get("gameName");

                        if (tripsFilter(gameName)) {
                            socket.send(new Uint8Array([255, 0, ...stringToU8("Please do not use vulgar profanity in your game name")]));
                            socket.close();
                            return;
                        }

                        const lobby = new Lobby(socket, gameName);
                        lobby.define(
                            search.get("isModded"),
                            search.get("isPrivate"),
                            search.get("secretKey") || "",
                            search.get("gamemode"),
                            search.get("biome")
                        );

                        if (search.has("directConnect")) {
                            const directConnect = validate.directConnect(search.get("directConnect"));

                            if (directConnect !== null) {
                                try {
                                    lobby.setDirectConnect(directConnect.address, directConnect.timeZone);
                                } catch (e) {
                                    console.log(e);
                                    socket.send(new Uint8Array([255, 0, ...stringToU8(e.message)]));
                                    socket.terminate();
                                    return;
                                }
                            }
                        }

                        socket.data.analytics.define("lobby", {
                            modded: lobby.isModded,
                            private: lobby.isPrivate,
                            gamemode: lobby.gamemode,
                            biome: lobby.biome
                        });

                        lobby.begin();
                        socket.data.lobby = lobby;
                    } catch (e) {
                        console.log(e);
                        socket.send(new Uint8Array([255, 0, ...stringToU8(e.message)]));
                        socket.terminate();
                    }
                    break;
                case SOCKET_TYPE_CLIENT:
                    if (IP_TABLES[socket.data.address] > 100) {
                        console.log("Rate limit exceeded");
                        return socket.terminate();
                    }

                    try {
                        const uuid = search.get("uuid");
                        /** @type {string} */
                        const partyURL = search.get("partyURL");
                        const uuidData = getUUIDData(uuid);

                        if (!uuidData || uuidData.expiresAt < new Date() || !Lobby.lobbies[partyURL]) {
                            socket.terminate();
                            return;
                        }

                        IP_TABLES[socket.data.address] = IP_TABLES[socket.data.address] ? IP_TABLES[socket.data.address] + 1 : 1;

                        const lobby = Lobby.lobbies[partyURL];
                        lobby.addClient(socket, uuid, search.get("clientKey") || "");
                        socket.data.lobby = lobby;

                        socket.data.analytics.define("client", {
                            gamemode: lobby.gamemode,
                            biome: lobby.biome
                        });
                    } catch (e) {
                        socket.terminate();
                    }
                    break;
                default:
                    socket.close();
                    break;
            }
        },

        close(socket, code, reason) {
            console.log(`WS CLOSED: code=${code}, type=${socket.data.type}, reason=${reason}`);
            if (code === 1006) console.log("BUN IDLE TIMEOUT — FIX: idleTimeout: 0");
            if (socket.data.analytics) {
                socket.data.analytics.end();
            }

            switch (socket.data.type) {
                case SOCKET_TYPE_LOBBY: {
                    if (socket.data.lobby) {
                        socket.data.lobby.destroy();
                    }
                } break;
                case SOCKET_TYPE_CLIENT:
                    if (socket.data.lobby) {
                        try {
                            socket.data.lobby.removeClient(socket.data.clientID);

                            if (IP_TABLES[socket.data.address] > 0) {
                                IP_TABLES[socket.data.address]--;

                                if (IP_TABLES[socket.data.address] === 0) {
                                    delete IP_TABLES[socket.data.address];
                                }
                            }
                        } catch (e) { console.error; }
                    }
                    break;
            }
        },

        message(socket, data) {
            if (typeof data === "string" || data.byteLength === 0) {
                return;
            }

            switch (socket.data.type) {
                case SOCKET_TYPE_LOBBY: {
                    const message = new Uint8Array(data);

                    if (message.length === 0 || socket.data.lobby === undefined) return;

                    /** @type {Lobby} */
                    const lobby = socket.data.lobby;
                    switch (message[0]) {
                        case 0x00:
                            lobby.removeClient(u8ToU16(message, 1));
                            break;
                        case 0x01:
                            lobby.pipe(message);
                            break;
                        case 0x02:
                            try {
                                lobby.resources = JSON.parse(u8ToString(message, 1));

                                if (lobby.resources[0] > 30) {
                                    socket.send(new Uint8Array([255, 0, ...stringToU8("You have too many rarities! Quantity must be less than or equal to 30.")]));
                                    return;
                                }

                                lobby.sendMagic();
                            } catch (e) {
                                socket.send(new Uint8Array([255, 0, ...stringToU8("Invalid JSON resources")]));
                            }
                            break;
                        case 0x03:
                            try {
                                if (lobby.trusted && lobby.directConnect) {
                                    const analytics = u8ToString(message, 1);
                                    const totalTime = u8ToString(message, 1 + analytics.length + 1);
    
                                    const entry = AnalyticsEntry.fromBase64(analytics);
                                    entry.define("client", {
                                        gamemode: lobby.gamemode,
                                        biome: lobby.biome
                                    });
                                    entry.end(totalTime);
                                }
                            } catch (e) {}
                            break;
                    }
                } break;
                case SOCKET_TYPE_CLIENT: {
                    if (!socket.data.lobby) {
                        return;
                    }

                    /** @type {Lobby} */
                    const lobby = socket.data.lobby;

                    try {
                        const message = new Uint8Array(data);

                        if (message.length === 0 || message.length > 1024) {
                            return;
                        }

                        lobby.ownerSocket.send(new Uint8Array([0x01, ...u16ToU8(socket.data.clientID), ...message]));
                    } catch (e) { }
                } break;
            }
        }
    },

    port: Bun.env.PORT,
    tls: Bun.env.TLS_DIRECTORY !== "false" ? {
        key: Bun.file(`${Bun.env.TLS_DIRECTORY}/privkey.pem`),
        cert: Bun.file(`${Bun.env.TLS_DIRECTORY}/fullchain.pem`)
    } : undefined
});

logToWebhook("Server started:", server.url.toString());