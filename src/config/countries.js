'use strict';

/**
 * Central catalogue of every Google AdSense-supported country/territory.
 *
 * This is the single source of truth for market metadata. Each entry becomes
 * one market: the US runs on the apex domain and every other country on its
 * `<code>.listnear.app` subdomain (see `src/config/market.js`). Region/city
 * seed data lives in `src/config/regions.js`; a country is only served when it
 * has real region data (or an explicit `enabled: true`).
 *
 * Territory exclusions follow Google's list: Crimea, Cuba, Iran, North Korea
 * and the so-called DNR/LNR are intentionally absent. Uninhabited territories
 * (Antarctica, Bouvet Island, Heard & McDonald, South Georgia, French Southern
 * Territories, British Indian Ocean Territory) carry no region data and stay
 * disabled, as required — nothing here is invented.
 *
 * Metadata (currency, locale, dial code, emergency number) is from public
 * references: ISO 4217, BCP 47, ITU E.164 and public emergency-number tables.
 * See SOURCES.md.
 */

const REGIONS = require('./regions');

const ROOT_DOMAIN = String(process.env.ROOT_DOMAIN || 'listnear.app').toLowerCase();

// Host labels that must never be treated as a country subdomain.
const RESERVED_SUBDOMAINS = new Set([
  'www', 'mail', 'webmail', 'admin', 'api', 'static', 'cdn', 'm', 'dev', 'staging', 'origin', 'ns', 'ftp', 'smtp',
]);

// Friendly host aliases → canonical ISO code.
const HOST_ALIASES = { uk: 'gb' };

// [code, name, currency, locale, language, dialCode, units, emergencyNumber, nativeName]
// `units` defaults to 'metric' and `emergencyNumber` to '' when omitted.
const RAW = [
  ['ad', 'Andorra', 'EUR', 'ca-AD', 'ca', '+376'],
  ['ae', 'United Arab Emirates', 'AED', 'ar-AE', 'ar', '+971', 'metric', '999', 'الإمارات العربية المتحدة'],
  ['ag', 'Antigua and Barbuda', 'XCD', 'en-AG', 'en', '+1268', 'metric', '911'],
  ['ai', 'Anguilla', 'XCD', 'en-AI', 'en', '+1264', 'metric', '911'],
  ['al', 'Albania', 'ALL', 'sq-AL', 'sq', '+355', 'metric', '112'],
  ['am', 'Armenia', 'AMD', 'hy-AM', 'hy', '+374', 'metric', '112'],
  ['ao', 'Angola', 'AOA', 'pt-AO', 'pt', '+244', 'metric', '113'],
  ['aq', 'Antarctica', '', 'en-AQ', 'en', '+672'],
  ['ar', 'Argentina', 'ARS', 'es-AR', 'es', '+54', 'metric', '911'],
  ['as', 'American Samoa', 'USD', 'en-AS', 'en', '+1684', 'metric', '911'],
  ['at', 'Austria', 'EUR', 'de-AT', 'de', '+43', 'metric', '112'],
  ['au', 'Australia', 'AUD', 'en-AU', 'en', '+61', 'metric', '000'],
  ['aw', 'Aruba', 'AWG', 'nl-AW', 'nl', '+297', 'metric', '911'],
  ['az', 'Azerbaijan', 'AZN', 'az-AZ', 'az', '+994', 'metric', '112'],
  ['ba', 'Bosnia and Herzegovina', 'BAM', 'bs-BA', 'bs', '+387', 'metric', '112'],
  ['bb', 'Barbados', 'BBD', 'en-BB', 'en', '+1246', 'metric', '911'],
  ['bd', 'Bangladesh', 'BDT', 'bn-BD', 'bn', '+880', 'metric', '999'],
  ['be', 'Belgium', 'EUR', 'nl-BE', 'nl', '+32', 'metric', '112'],
  ['bf', 'Burkina Faso', 'XOF', 'fr-BF', 'fr', '+226', 'metric', '112'],
  ['bg', 'Bulgaria', 'BGN', 'bg-BG', 'bg', '+359', 'metric', '112'],
  ['bh', 'Bahrain', 'BHD', 'ar-BH', 'ar', '+973', 'metric', '999'],
  ['bi', 'Burundi', 'BIF', 'fr-BI', 'fr', '+257', 'metric', '112'],
  ['bj', 'Benin', 'XOF', 'fr-BJ', 'fr', '+229', 'metric', '112'],
  ['bm', 'Bermuda', 'BMD', 'en-BM', 'en', '+1441', 'metric', '911'],
  ['bn', 'Brunei', 'BND', 'ms-BN', 'ms', '+673', 'metric', '991'],
  ['bo', 'Bolivia', 'BOB', 'es-BO', 'es', '+591', 'metric', '911'],
  ['br', 'Brazil', 'BRL', 'pt-BR', 'pt', '+55', 'metric', '190', 'Brasil'],
  ['bs', 'Bahamas', 'BSD', 'en-BS', 'en', '+1242', 'metric', '911'],
  ['bt', 'Bhutan', 'BTN', 'dz-BT', 'dz', '+975', 'metric', '113'],
  ['bv', 'Bouvet Island', '', 'en-BV', 'en', '+47'],
  ['bw', 'Botswana', 'BWP', 'en-BW', 'en', '+267', 'metric', '999'],
  ['bz', 'Belize', 'BZD', 'en-BZ', 'en', '+501', 'metric', '911'],
  ['ca', 'Canada', 'CAD', 'en-CA', 'en', '+1', 'metric', '911'],
  ['cc', 'Cocos (Keeling) Islands', 'AUD', 'en-CC', 'en', '+61', 'metric', '000'],
  ['cd', 'Congo - Kinshasa', 'CDF', 'fr-CD', 'fr', '+243', 'metric', '112'],
  ['cf', 'Central African Republic', 'XAF', 'fr-CF', 'fr', '+236', 'metric', '112'],
  ['cg', 'Congo - Brazzaville', 'XAF', 'fr-CG', 'fr', '+242', 'metric', '112'],
  ['ch', 'Switzerland', 'CHF', 'de-CH', 'de', '+41', 'metric', '112', 'Schweiz'],
  ['ci', "Côte d'Ivoire", 'XOF', 'fr-CI', 'fr', '+225', 'metric', '112'],
  ['ck', 'Cook Islands', 'NZD', 'en-CK', 'en', '+682', 'metric', '999'],
  ['cl', 'Chile', 'CLP', 'es-CL', 'es', '+56', 'metric', '131'],
  ['cm', 'Cameroon', 'XAF', 'fr-CM', 'fr', '+237', 'metric', '112'],
  ['cn', 'China', 'CNY', 'zh-CN', 'zh', '+86', 'metric', '110', '中国'],
  ['co', 'Colombia', 'COP', 'es-CO', 'es', '+57', 'metric', '123'],
  ['cr', 'Costa Rica', 'CRC', 'es-CR', 'es', '+506', 'metric', '911'],
  ['cv', 'Cape Verde', 'CVE', 'pt-CV', 'pt', '+238', 'metric', '112'],
  ['cw', 'Curaçao', 'ANG', 'nl-CW', 'nl', '+599', 'metric', '911'],
  ['cx', 'Christmas Island', 'AUD', 'en-CX', 'en', '+61', 'metric', '000'],
  ['cy', 'Cyprus', 'EUR', 'el-CY', 'el', '+357', 'metric', '112'],
  ['cz', 'Czechia', 'CZK', 'cs-CZ', 'cs', '+420', 'metric', '112', 'Česko'],
  ['de', 'Germany', 'EUR', 'de-DE', 'de', '+49', 'metric', '112', 'Deutschland'],
  ['dj', 'Djibouti', 'DJF', 'fr-DJ', 'fr', '+253', 'metric', '17'],
  ['dk', 'Denmark', 'DKK', 'da-DK', 'da', '+45', 'metric', '112'],
  ['dm', 'Dominica', 'XCD', 'en-DM', 'en', '+1767', 'metric', '911'],
  ['do', 'Dominican Republic', 'DOP', 'es-DO', 'es', '+1809', 'metric', '911'],
  ['dz', 'Algeria', 'DZD', 'ar-DZ', 'ar', '+213', 'metric', '14'],
  ['ec', 'Ecuador', 'USD', 'es-EC', 'es', '+593', 'metric', '911'],
  ['ee', 'Estonia', 'EUR', 'et-EE', 'et', '+372', 'metric', '112'],
  ['eg', 'Egypt', 'EGP', 'ar-EG', 'ar', '+20', 'metric', '122'],
  ['eh', 'Western Sahara', 'MAD', 'ar-EH', 'ar', '+212', 'metric', ''],
  ['er', 'Eritrea', 'ERN', 'ti-ER', 'ti', '+291', 'metric', '112'],
  ['es', 'Spain', 'EUR', 'es-ES', 'es', '+34', 'metric', '112', 'España'],
  ['et', 'Ethiopia', 'ETB', 'am-ET', 'am', '+251', 'metric', '911'],
  ['fi', 'Finland', 'EUR', 'fi-FI', 'fi', '+358', 'metric', '112'],
  ['fj', 'Fiji', 'FJD', 'en-FJ', 'en', '+679', 'metric', '911'],
  ['fk', 'Falkland Islands', 'FKP', 'en-FK', 'en', '+500', 'metric', '999'],
  ['fm', 'Micronesia', 'USD', 'en-FM', 'en', '+691', 'metric', '911'],
  ['fo', 'Faroe Islands', 'DKK', 'fo-FO', 'fo', '+298', 'metric', '112'],
  ['fr', 'France', 'EUR', 'fr-FR', 'fr', '+33', 'metric', '112', 'France'],
  ['ga', 'Gabon', 'XAF', 'fr-GA', 'fr', '+241', 'metric', '112'],
  ['gb', 'United Kingdom', 'GBP', 'en-GB', 'en', '+44', 'metric', '999', 'United Kingdom'],
  ['gd', 'Grenada', 'XCD', 'en-GD', 'en', '+1473', 'metric', '911'],
  ['ge', 'Georgia', 'GEL', 'ka-GE', 'ka', '+995', 'metric', '112'],
  ['gf', 'French Guiana', 'EUR', 'fr-GF', 'fr', '+594', 'metric', '112'],
  ['gh', 'Ghana', 'GHS', 'en-GH', 'en', '+233', 'metric', '112'],
  ['gi', 'Gibraltar', 'GIP', 'en-GI', 'en', '+350', 'metric', '112'],
  ['gl', 'Greenland', 'DKK', 'kl-GL', 'kl', '+299', 'metric', '112'],
  ['gm', 'Gambia', 'GMD', 'en-GM', 'en', '+220', 'metric', '116'],
  ['gn', 'Guinea', 'GNF', 'fr-GN', 'fr', '+224', 'metric', '112'],
  ['gp', 'Guadeloupe', 'EUR', 'fr-GP', 'fr', '+590', 'metric', '112'],
  ['gq', 'Equatorial Guinea', 'XAF', 'es-GQ', 'es', '+240', 'metric', '112'],
  ['gr', 'Greece', 'EUR', 'el-GR', 'el', '+30', 'metric', '112'],
  ['gs', 'South Georgia and South Sandwich Islands', '', 'en-GS', 'en', '+500'],
  ['gt', 'Guatemala', 'GTQ', 'es-GT', 'es', '+502', 'metric', '110'],
  ['gu', 'Guam', 'USD', 'en-GU', 'en', '+1671', 'metric', '911'],
  ['gw', 'Guinea-Bissau', 'XOF', 'pt-GW', 'pt', '+245', 'metric', '112'],
  ['gy', 'Guyana', 'GYD', 'en-GY', 'en', '+592', 'metric', '911'],
  ['hk', 'Hong Kong', 'HKD', 'zh-HK', 'zh', '+852', 'metric', '999', '香港'],
  ['hm', 'Heard and McDonald Islands', '', 'en-HM', 'en', '+672'],
  ['hn', 'Honduras', 'HNL', 'es-HN', 'es', '+504', 'metric', '911'],
  ['hr', 'Croatia', 'EUR', 'hr-HR', 'hr', '+385', 'metric', '112', 'Hrvatska'],
  ['ht', 'Haiti', 'HTG', 'fr-HT', 'fr', '+509', 'metric', '114'],
  ['hu', 'Hungary', 'HUF', 'hu-HU', 'hu', '+36', 'metric', '112', 'Magyarország'],
  ['id', 'Indonesia', 'IDR', 'id-ID', 'id', '+62', 'metric', '112'],
  ['ie', 'Ireland', 'EUR', 'en-IE', 'en', '+353', 'metric', '999', 'Éire'],
  ['il', 'Israel', 'ILS', 'he-IL', 'he', '+972', 'metric', '100'],
  ['in', 'India', 'INR', 'en-IN', 'en', '+91', 'metric', '112', 'India'],
  ['io', 'British Indian Ocean Territory', 'USD', 'en-IO', 'en', '+246'],
  ['iq', 'Iraq', 'IQD', 'ar-IQ', 'ar', '+964', 'metric', '112'],
  ['is', 'Iceland', 'ISK', 'is-IS', 'is', '+354', 'metric', '112', 'Ísland'],
  ['it', 'Italy', 'EUR', 'it-IT', 'it', '+39', 'metric', '112', 'Italia'],
  ['jm', 'Jamaica', 'JMD', 'en-JM', 'en', '+1876', 'metric', '119'],
  ['jo', 'Jordan', 'JOD', 'ar-JO', 'ar', '+962', 'metric', '911'],
  ['jp', 'Japan', 'JPY', 'ja-JP', 'ja', '+81', 'metric', '', '日本'],
  ['ke', 'Kenya', 'KES', 'en-KE', 'en', '+254', 'metric', '999'],
  ['kg', 'Kyrgyzstan', 'KGS', 'ky-KG', 'ky', '+996', 'metric', '112'],
  ['kh', 'Cambodia', 'KHR', 'km-KH', 'km', '+855', 'metric', '117'],
  ['ki', 'Kiribati', 'AUD', 'en-KI', 'en', '+686', 'metric', '999'],
  ['km', 'Comoros', 'KMF', 'fr-KM', 'fr', '+269', 'metric', '17'],
  ['kn', 'St. Kitts and Nevis', 'XCD', 'en-KN', 'en', '+1869', 'metric', '911'],
  ['kr', 'South Korea', 'KRW', 'ko-KR', 'ko', '+82', 'metric', '112', '대한민국'],
  ['kw', 'Kuwait', 'KWD', 'ar-KW', 'ar', '+965', 'metric', '112'],
  ['ky', 'Cayman Islands', 'KYD', 'en-KY', 'en', '+1345', 'metric', '911'],
  ['kz', 'Kazakhstan', 'KZT', 'kk-KZ', 'kk', '+7', 'metric', '112'],
  ['la', 'Laos', 'LAK', 'lo-LA', 'lo', '+856', 'metric', '1191'],
  ['lb', 'Lebanon', 'LBP', 'ar-LB', 'ar', '+961', 'metric', '112'],
  ['lc', 'St. Lucia', 'XCD', 'en-LC', 'en', '+1758', 'metric', '911'],
  ['li', 'Liechtenstein', 'CHF', 'de-LI', 'de', '+423', 'metric', '112'],
  ['lk', 'Sri Lanka', 'LKR', 'si-LK', 'si', '+94', 'metric', '119'],
  ['lr', 'Liberia', 'LRD', 'en-LR', 'en', '+231', 'metric', '911'],
  ['ls', 'Lesotho', 'LSL', 'en-LS', 'en', '+266', 'metric', '112'],
  ['lt', 'Lithuania', 'EUR', 'lt-LT', 'lt', '+370', 'metric', '112'],
  ['lu', 'Luxembourg', 'EUR', 'fr-LU', 'fr', '+352', 'metric', '112'],
  ['lv', 'Latvia', 'EUR', 'lv-LV', 'lv', '+371', 'metric', '112'],
  ['ly', 'Libya', 'LYD', 'ar-LY', 'ar', '+218', 'metric', '1515'],
  ['ma', 'Morocco', 'MAD', 'ar-MA', 'ar', '+212', 'metric', '15'],
  ['mc', 'Monaco', 'EUR', 'fr-MC', 'fr', '+377', 'metric', '112'],
  ['md', 'Moldova', 'MDL', 'ro-MD', 'ro', '+373', 'metric', '112'],
  ['me', 'Montenegro', 'EUR', 'sr-ME', 'sr', '+382', 'metric', '112'],
  ['mg', 'Madagascar', 'MGA', 'mg-MG', 'mg', '+261', 'metric', '117'],
  ['mh', 'Marshall Islands', 'USD', 'en-MH', 'en', '+692', 'metric', '911'],
  ['mk', 'North Macedonia', 'MKD', 'mk-MK', 'mk', '+389', 'metric', '112'],
  ['ml', 'Mali', 'XOF', 'fr-ML', 'fr', '+223', 'metric', '112'],
  ['mn', 'Mongolia', 'MNT', 'mn-MN', 'mn', '+976', 'metric', '102'],
  ['mo', 'Macao', 'MOP', 'zh-MO', 'zh', '+853', 'metric', '999', '澳門'],
  ['mp', 'Northern Mariana Islands', 'USD', 'en-MP', 'en', '+1670', 'metric', '911'],
  ['mq', 'Martinique', 'EUR', 'fr-MQ', 'fr', '+596', 'metric', '112'],
  ['mr', 'Mauritania', 'MRU', 'ar-MR', 'ar', '+222', 'metric', '117'],
  ['ms', 'Montserrat', 'XCD', 'en-MS', 'en', '+1664', 'metric', '911'],
  ['mt', 'Malta', 'EUR', 'mt-MT', 'mt', '+356', 'metric', '112'],
  ['mu', 'Mauritius', 'MUR', 'en-MU', 'en', '+230', 'metric', '999'],
  ['mv', 'Maldives', 'MVR', 'dv-MV', 'dv', '+960', 'metric', '119'],
  ['mw', 'Malawi', 'MWK', 'en-MW', 'en', '+265', 'metric', '998'],
  ['mx', 'Mexico', 'MXN', 'es-MX', 'es', '+52', 'metric', '911', 'México'],
  ['my', 'Malaysia', 'MYR', 'ms-MY', 'ms', '+60', 'metric', '999'],
  ['mz', 'Mozambique', 'MZN', 'pt-MZ', 'pt', '+258', 'metric', '119'],
  ['na', 'Namibia', 'NAD', 'en-NA', 'en', '+264', 'metric', '10111'],
  ['nc', 'New Caledonia', 'XPF', 'fr-NC', 'fr', '+687', 'metric', '17'],
  ['ne', 'Niger', 'XOF', 'fr-NE', 'fr', '+227', 'metric', '112'],
  ['nf', 'Norfolk Island', 'AUD', 'en-NF', 'en', '+672', 'metric', '000'],
  ['ng', 'Nigeria', 'NGN', 'en-NG', 'en', '+234', 'metric', '112'],
  ['ni', 'Nicaragua', 'NIO', 'es-NI', 'es', '+505', 'metric', '911'],
  ['nl', 'Netherlands', 'EUR', 'nl-NL', 'nl', '+31', 'metric', '112', 'Nederland'],
  ['no', 'Norway', 'NOK', 'nb-NO', 'nb', '+47', 'metric', '112', 'Norge'],
  ['np', 'Nepal', 'NPR', 'ne-NP', 'ne', '+977', 'metric', '100'],
  ['nr', 'Nauru', 'AUD', 'en-NR', 'en', '+674', 'metric', '110'],
  ['nu', 'Niue', 'NZD', 'en-NU', 'en', '+683', 'metric', '999'],
  ['nz', 'New Zealand', 'NZD', 'en-NZ', 'en', '+64', 'metric', '111'],
  ['om', 'Oman', 'OMR', 'ar-OM', 'ar', '+968', 'metric', '9999'],
  ['pa', 'Panama', 'PAB', 'es-PA', 'es', '+507', 'metric', '911'],
  ['pe', 'Peru', 'PEN', 'es-PE', 'es', '+51', 'metric', '105'],
  ['pf', 'French Polynesia', 'XPF', 'fr-PF', 'fr', '+689', 'metric', '15'],
  ['pg', 'Papua New Guinea', 'PGK', 'en-PG', 'en', '+675', 'metric', '112'],
  ['ph', 'Philippines', 'PHP', 'en-PH', 'en', '+63', 'metric', '911'],
  ['pk', 'Pakistan', 'PKR', 'en-PK', 'en', '+92', 'metric', '15'],
  ['pl', 'Poland', 'PLN', 'pl-PL', 'pl', '+48', 'metric', '112', 'Polska'],
  ['pm', 'St. Pierre and Miquelon', 'EUR', 'fr-PM', 'fr', '+508', 'metric', '112'],
  ['pn', 'Pitcairn Islands', 'NZD', 'en-PN', 'en', '+64', 'metric', '911'],
  ['pr', 'Puerto Rico', 'USD', 'es-PR', 'es', '+1787', 'metric', '911'],
  ['ps', 'Palestine', 'ILS', 'ar-PS', 'ar', '+970', 'metric', '101'],
  ['pt', 'Portugal', 'EUR', 'pt-PT', 'pt', '+351', 'metric', '112'],
  ['pw', 'Palau', 'USD', 'en-PW', 'en', '+680', 'metric', '911'],
  ['py', 'Paraguay', 'PYG', 'es-PY', 'es', '+595', 'metric', '911'],
  ['qa', 'Qatar', 'QAR', 'ar-QA', 'ar', '+974', 'metric', '999'],
  ['re', 'Réunion', 'EUR', 'fr-RE', 'fr', '+262', 'metric', '112'],
  ['ro', 'Romania', 'RON', 'ro-RO', 'ro', '+40', 'metric', '112'],
  ['rs', 'Serbia', 'RSD', 'sr-RS', 'sr', '+381', 'metric', '112'],
  ['rw', 'Rwanda', 'RWF', 'rw-RW', 'rw', '+250', 'metric', '112'],
  ['sa', 'Saudi Arabia', 'SAR', 'ar-SA', 'ar', '+966', 'metric', '999', 'السعودية'],
  ['sb', 'Solomon Islands', 'SBD', 'en-SB', 'en', '+677', 'metric', '999'],
  ['sc', 'Seychelles', 'SCR', 'en-SC', 'en', '+248', 'metric', '999'],
  ['sd', 'Sudan', 'SDG', 'ar-SD', 'ar', '+249', 'metric', '999'],
  ['se', 'Sweden', 'SEK', 'sv-SE', 'sv', '+46', 'metric', '112', 'Sverige'],
  ['sg', 'Singapore', 'SGD', 'en-SG', 'en', '+65', 'metric', '995'],
  ['sh', 'St. Helena', 'SHP', 'en-SH', 'en', '+290', 'metric', '999'],
  ['si', 'Slovenia', 'EUR', 'sl-SI', 'sl', '+386', 'metric', '112', 'Slovenija'],
  ['sj', 'Svalbard and Jan Mayen', 'NOK', 'nb-SJ', 'nb', '+47', 'metric', '112'],
  ['sk', 'Slovakia', 'EUR', 'sk-SK', 'sk', '+421', 'metric', '112', 'Slovensko'],
  ['sl', 'Sierra Leone', 'SLL', 'en-SL', 'en', '+232', 'metric', '999'],
  ['sm', 'San Marino', 'EUR', 'it-SM', 'it', '+378', 'metric', '112'],
  ['sn', 'Senegal', 'XOF', 'fr-SN', 'fr', '+221', 'metric', '17'],
  ['sr', 'Suriname', 'SRD', 'nl-SR', 'nl', '+597', 'metric', '115'],
  ['st', 'São Tomé and Principe', 'STN', 'pt-ST', 'pt', '+239', 'metric', '112'],
  ['sv', 'El Salvador', 'USD', 'es-SV', 'es', '+503', 'metric', '911'],
  ['sz', 'Eswatini', 'SZL', 'en-SZ', 'en', '+268', 'metric', '999'],
  ['tc', 'Turks and Caicos', 'USD', 'en-TC', 'en', '+1649', 'metric', '911'],
  ['td', 'Chad', 'XAF', 'fr-TD', 'fr', '+235', 'metric', '17'],
  ['tf', 'French Southern Territories', '', 'fr-TF', 'fr', '+262'],
  ['tg', 'Togo', 'XOF', 'fr-TG', 'fr', '+228', 'metric', '112'],
  ['th', 'Thailand', 'THB', 'th-TH', 'th', '+66', 'metric', '191', 'ไทย'],
  ['tj', 'Tajikistan', 'TJS', 'tg-TJ', 'tg', '+992', 'metric', '112'],
  ['tk', 'Tokelau', 'NZD', 'en-TK', 'en', '+690', 'metric', '999'],
  ['tl', 'Timor-Leste', 'USD', 'pt-TL', 'pt', '+670', 'metric', '112'],
  ['tm', 'Turkmenistan', 'TMT', 'tk-TM', 'tk', '+993', 'metric', '112'],
  ['tn', 'Tunisia', 'TND', 'ar-TN', 'ar', '+216', 'metric', '190'],
  ['to', 'Tonga', 'TOP', 'en-TO', 'en', '+676', 'metric', '911'],
  ['tr', 'Türkiye', 'TRY', 'tr-TR', 'tr', '+90', 'metric', '112', 'Türkiye'],
  ['tt', 'Trinidad and Tobago', 'TTD', 'en-TT', 'en', '+1868', 'metric', '911'],
  ['tv', 'Tuvalu', 'AUD', 'en-TV', 'en', '+688', 'metric', '911'],
  ['tw', 'Taiwan', 'TWD', 'zh-TW', 'zh', '+886', 'metric', '119', '台灣'],
  ['tz', 'Tanzania', 'TZS', 'sw-TZ', 'sw', '+255', 'metric', '112'],
  ['ua', 'Ukraine', 'UAH', 'uk-UA', 'uk', '+380', 'metric', '112', 'Україна'],
  ['ug', 'Uganda', 'UGX', 'en-UG', 'en', '+256', 'metric', '112'],
  ['um', 'U.S. Outlying Islands', 'USD', 'en-UM', 'en', '+1', 'metric', '911'],
  ['us', 'United States', 'USD', 'en-US', 'en', '+1', 'imperial', '911', 'United States'],
  ['uy', 'Uruguay', 'UYU', 'es-UY', 'es', '+598', 'metric', '911'],
  ['uz', 'Uzbekistan', 'UZS', 'uz-UZ', 'uz', '+998', 'metric', '112'],
  ['va', 'Vatican City', 'EUR', 'it-VA', 'it', '+39', 'metric', '112'],
  ['vc', 'St. Vincent and Grenadines', 'XCD', 'en-VC', 'en', '+1784', 'metric', '911'],
  ['ve', 'Venezuela', 'VES', 'es-VE', 'es', '+58', 'metric', '911'],
  ['vg', 'British Virgin Islands', 'USD', 'en-VG', 'en', '+1284', 'metric', '911'],
  ['vi', 'U.S. Virgin Islands', 'USD', 'en-VI', 'en', '+1340', 'metric', '911'],
  ['vn', 'Vietnam', 'VND', 'vi-VN', 'vi', '+84', 'metric', '113', 'Việt Nam'],
  ['vu', 'Vanuatu', 'VUV', 'en-VU', 'en', '+678', 'metric', '112'],
  ['wf', 'Wallis and Futuna', 'XPF', 'fr-WF', 'fr', '+681', 'metric', '15'],
  ['ws', 'Samoa', 'WST', 'sm-WS', 'sm', '+685', 'metric', '999'],
  ['ye', 'Yemen', 'YER', 'ar-YE', 'ar', '+967', 'metric', '191'],
  ['yt', 'Mayotte', 'EUR', 'fr-YT', 'fr', '+262', 'metric', '112'],
  ['za', 'South Africa', 'ZAR', 'en-ZA', 'en', '+27', 'metric', '112'],
  ['zm', 'Zambia', 'ZMW', 'en-ZM', 'en', '+260', 'metric', '112'],
  ['zw', 'Zimbabwe', 'ZWL', 'en-ZW', 'en', '+263', 'metric', '112'],
];

const DEFAULT_SUPPORT_URL = 'https://buymeacoffee.com/aussieloo?ref=listnear';
const DEFAULT_CONTACT_EMAIL = 'support@listnear.app';

/** Derive the canonical public origin for a country code. */
function urlFor(code) {
  return code === 'us' ? `https://${ROOT_DOMAIN}` : `https://${code}.${ROOT_DOMAIN}`;
}

const COUNTRIES = RAW.map((row) => {
  const [code, name, currency, locale, language, dial, units = 'metric', emergencyNumber = '', nativeName = ''] = row;
  const regions = REGIONS[code] || {};
  return {
    code,
    name,
    nativeName: nativeName || name,
    subdomain: code === 'us' ? null : code,
    url: urlFor(code),
    currency,
    locale,
    language,
    languages: [language],
    phone: { dialCode: dial, example: '' },
    units,
    emergencyNumber,
    contactEmail: DEFAULT_CONTACT_EMAIL,
    supportUrl: DEFAULT_SUPPORT_URL,
    enabled: Boolean(REGIONS[code]),
    regions,
  };
});

const BY_CODE = Object.fromEntries(COUNTRIES.map((c) => [c.code, c]));

/** Look up a country by ISO code (lower-case). Returns undefined when absent. */
function getCountry(code) {
  return BY_CODE[String(code || '').toLowerCase()];
}

/** All enabled markets, sorted by English name. */
function enabledCountries() {
  return COUNTRIES.filter((c) => c.enabled).sort((a, b) => a.name.localeCompare(b.name));
}

module.exports = {
  ROOT_DOMAIN,
  RESERVED_SUBDOMAINS,
  HOST_ALIASES,
  COUNTRIES,
  getCountry,
  enabledCountries,
};
