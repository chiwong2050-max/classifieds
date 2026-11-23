'use strict';

/**
 * Region (state/province) → cities seed data, keyed by ISO 3166-1 alpha-2
 * country code. Only real, well-known administrative regions and their major
 * cities are listed; nothing here is invented. See SOURCES.md for provenance.
 *
 * Keys are URL-safe slugs (the `slugify` helper in locations.js normalises
 * city display names to the same shape, so accents in a name are fine).
 *
 * Countries not present here are still registered in `countries.js`; they stay
 * `enabled: false` until a real region/city list is added.
 */

module.exports = {
  // --- United States (all 50 states + DC) ------------------------------------
  us: {
    al: { name: 'Alabama', cities: ['Birmingham', 'Montgomery', 'Mobile', 'Huntsville', 'Tuscaloosa'] },
    ak: { name: 'Alaska', cities: ['Anchorage', 'Fairbanks', 'Juneau', 'Sitka'] },
    az: { name: 'Arizona', cities: ['Phoenix', 'Tucson', 'Mesa', 'Scottsdale', 'Flagstaff'] },
    ar: { name: 'Arkansas', cities: ['Little Rock', 'Fort Smith', 'Fayetteville', 'Springdale'] },
    ca: { name: 'California', cities: ['Los Angeles', 'San Francisco', 'San Diego', 'Sacramento', 'San Jose'] },
    co: { name: 'Colorado', cities: ['Denver', 'Colorado Springs', 'Aurora', 'Boulder', 'Fort Collins'] },
    ct: { name: 'Connecticut', cities: ['Bridgeport', 'New Haven', 'Hartford', 'Stamford'] },
    de: { name: 'Delaware', cities: ['Wilmington', 'Dover', 'Newark', 'Middletown'] },
    dc: { name: 'District of Columbia', cities: ['Washington'] },
    fl: { name: 'Florida', cities: ['Miami', 'Orlando', 'Tampa', 'Jacksonville', 'Tallahassee'] },
    ga: { name: 'Georgia', cities: ['Atlanta', 'Augusta', 'Columbus', 'Savannah', 'Athens'] },
    hi: { name: 'Hawaii', cities: ['Honolulu', 'Hilo', 'Kailua', 'Kaneohe'] },
    id: { name: 'Idaho', cities: ['Boise', 'Meridian', 'Nampa', 'Idaho Falls'] },
    il: { name: 'Illinois', cities: ['Chicago', 'Aurora', 'Naperville', 'Springfield'] },
    in: { name: 'Indiana', cities: ['Indianapolis', 'Fort Wayne', 'Evansville', 'South Bend'] },
    ia: { name: 'Iowa', cities: ['Des Moines', 'Cedar Rapids', 'Davenport', 'Sioux City'] },
    ks: { name: 'Kansas', cities: ['Wichita', 'Overland Park', 'Kansas City', 'Topeka'] },
    ky: { name: 'Kentucky', cities: ['Louisville', 'Lexington', 'Bowling Green', 'Owensboro'] },
    la: { name: 'Louisiana', cities: ['New Orleans', 'Baton Rouge', 'Shreveport', 'Lafayette'] },
    me: { name: 'Maine', cities: ['Portland', 'Lewiston', 'Bangor', 'South Portland'] },
    md: { name: 'Maryland', cities: ['Baltimore', 'Frederick', 'Rockville', 'Annapolis'] },
    ma: { name: 'Massachusetts', cities: ['Boston', 'Worcester', 'Springfield', 'Cambridge'] },
    mi: { name: 'Michigan', cities: ['Detroit', 'Grand Rapids', 'Warren', 'Lansing'] },
    mn: { name: 'Minnesota', cities: ['Minneapolis', 'Saint Paul', 'Rochester', 'Duluth'] },
    ms: { name: 'Mississippi', cities: ['Jackson', 'Gulfport', 'Biloxi', 'Hattiesburg'] },
    mo: { name: 'Missouri', cities: ['Kansas City', 'Saint Louis', 'Springfield', 'Columbia'] },
    mt: { name: 'Montana', cities: ['Billings', 'Missoula', 'Great Falls', 'Bozeman'] },
    ne: { name: 'Nebraska', cities: ['Omaha', 'Lincoln', 'Bellevue', 'Grand Island'] },
    nv: { name: 'Nevada', cities: ['Las Vegas', 'Reno', 'Henderson', 'Sparks'] },
    nh: { name: 'New Hampshire', cities: ['Manchester', 'Nashua', 'Concord', 'Dover'] },
    nj: { name: 'New Jersey', cities: ['Newark', 'Jersey City', 'Paterson', 'Trenton'] },
    nm: { name: 'New Mexico', cities: ['Albuquerque', 'Las Cruces', 'Santa Fe', 'Roswell'] },
    ny: { name: 'New York', cities: ['New York City', 'Buffalo', 'Rochester', 'Albany', 'Syracuse'] },
    nc: { name: 'North Carolina', cities: ['Charlotte', 'Raleigh', 'Greensboro', 'Durham'] },
    nd: { name: 'North Dakota', cities: ['Fargo', 'Bismarck', 'Grand Forks', 'Minot'] },
    oh: { name: 'Ohio', cities: ['Columbus', 'Cleveland', 'Cincinnati', 'Toledo'] },
    ok: { name: 'Oklahoma', cities: ['Oklahoma City', 'Tulsa', 'Norman', 'Lawton'] },
    or: { name: 'Oregon', cities: ['Portland', 'Eugene', 'Salem', 'Bend'] },
    pa: { name: 'Pennsylvania', cities: ['Philadelphia', 'Pittsburgh', 'Allentown', 'Harrisburg'] },
    ri: { name: 'Rhode Island', cities: ['Providence', 'Warwick', 'Cranston', 'Newport'] },
    sc: { name: 'South Carolina', cities: ['Columbia', 'Charleston', 'Greenville', 'Myrtle Beach'] },
    sd: { name: 'South Dakota', cities: ['Sioux Falls', 'Rapid City', 'Aberdeen', 'Brookings'] },
    tn: { name: 'Tennessee', cities: ['Nashville', 'Memphis', 'Knoxville', 'Chattanooga'] },
    tx: { name: 'Texas', cities: ['Houston', 'Dallas', 'Austin', 'San Antonio', 'Fort Worth'] },
    ut: { name: 'Utah', cities: ['Salt Lake City', 'West Valley City', 'Provo', 'Ogden'] },
    vt: { name: 'Vermont', cities: ['Burlington', 'South Burlington', 'Rutland', 'Montpelier'] },
    va: { name: 'Virginia', cities: ['Virginia Beach', 'Norfolk', 'Richmond', 'Arlington'] },
    wa: { name: 'Washington', cities: ['Seattle', 'Spokane', 'Tacoma', 'Bellevue'] },
    wv: { name: 'West Virginia', cities: ['Charleston', 'Huntington', 'Morgantown', 'Parkersburg'] },
    wi: { name: 'Wisconsin', cities: ['Milwaukee', 'Madison', 'Green Bay', 'Kenosha'] },
    wy: { name: 'Wyoming', cities: ['Cheyenne', 'Casper', 'Laramie', 'Gillette'] },
  },

  // --- Australia (all states + territories) ----------------------------------
  au: {
    nsw: { name: 'New South Wales', cities: ['Sydney', 'Newcastle', 'Wollongong', 'Central Coast', 'Albury', 'Wagga Wagga'] },
    vic: { name: 'Victoria', cities: ['Melbourne', 'Geelong', 'Ballarat', 'Bendigo', 'Shepparton', 'Warrnambool'] },
    qld: { name: 'Queensland', cities: ['Brisbane', 'Gold Coast', 'Sunshine Coast', 'Townsville', 'Cairns', 'Toowoomba'] },
    wa: { name: 'Western Australia', cities: ['Perth', 'Mandurah', 'Bunbury', 'Geraldton', 'Albany', 'Kalgoorlie'] },
    sa: { name: 'South Australia', cities: ['Adelaide', 'Mount Gambier', 'Whyalla', 'Murray Bridge', 'Port Augusta'] },
    tas: { name: 'Tasmania', cities: ['Hobart', 'Launceston', 'Devonport', 'Burnie'] },
    act: { name: 'Australian Capital Territory', cities: ['Canberra', 'Belconnen', 'Gungahlin', 'Tuggeranong'] },
    nt: { name: 'Northern Territory', cities: ['Darwin', 'Alice Springs', 'Palmerston'] },
  },

  // --- United Kingdom --------------------------------------------------------
  gb: {
    england: { name: 'England', cities: ['London', 'Birmingham', 'Manchester', 'Liverpool', 'Leeds', 'Bristol', 'Sheffield', 'Newcastle upon Tyne', 'Nottingham', 'Leicester'] },
    scotland: { name: 'Scotland', cities: ['Glasgow', 'Edinburgh', 'Aberdeen', 'Dundee', 'Inverness'] },
    wales: { name: 'Wales', cities: ['Cardiff', 'Swansea', 'Newport', 'Wrexham'] },
    'northern-ireland': { name: 'Northern Ireland', cities: ['Belfast', 'Derry', 'Lisburn', 'Newry'] },
  },

  // --- Canada ----------------------------------------------------------------
  ca: {
    ontario: { name: 'Ontario', cities: ['Toronto', 'Ottawa', 'Mississauga', 'Hamilton', 'London', 'Brampton'] },
    quebec: { name: 'Quebec', cities: ['Montreal', 'Quebec City', 'Laval', 'Gatineau', 'Sherbrooke'] },
    'british-columbia': { name: 'British Columbia', cities: ['Vancouver', 'Victoria', 'Surrey', 'Kelowna', 'Burnaby'] },
    alberta: { name: 'Alberta', cities: ['Calgary', 'Edmonton', 'Red Deer', 'Lethbridge'] },
    manitoba: { name: 'Manitoba', cities: ['Winnipeg', 'Brandon'] },
    saskatchewan: { name: 'Saskatchewan', cities: ['Saskatoon', 'Regina', 'Prince Albert'] },
    'nova-scotia': { name: 'Nova Scotia', cities: ['Halifax', 'Sydney', 'Dartmouth'] },
    'new-brunswick': { name: 'New Brunswick', cities: ['Moncton', 'Saint John', 'Fredericton'] },
    'newfoundland-and-labrador': { name: 'Newfoundland and Labrador', cities: ["St. John's", 'Corner Brook'] },
    'prince-edward-island': { name: 'Prince Edward Island', cities: ['Charlottetown', 'Summerside'] },
  },

  // --- New Zealand -----------------------------------------------------------
  nz: {
    auckland: { name: 'Auckland', cities: ['Auckland', 'Manukau', 'North Shore', 'Papakura'] },
    waikato: { name: 'Waikato', cities: ['Hamilton', 'Cambridge', 'Taupo'] },
    'bay-of-plenty': { name: 'Bay of Plenty', cities: ['Tauranga', 'Rotorua', 'Whakatane'] },
    wellington: { name: 'Wellington', cities: ['Wellington', 'Lower Hutt', 'Porirua', 'Upper Hutt'] },
    canterbury: { name: 'Canterbury', cities: ['Christchurch', 'Timaru', 'Ashburton'] },
    otago: { name: 'Otago', cities: ['Dunedin', 'Queenstown', 'Oamaru'] },
    southland: { name: 'Southland', cities: ['Invercargill', 'Gore'] },
  },

  // --- Ireland ---------------------------------------------------------------
  ie: {
    leinster: { name: 'Leinster', cities: ['Dublin', 'Drogheda', 'Dundalk', 'Kilkenny'] },
    munster: { name: 'Munster', cities: ['Cork', 'Limerick', 'Waterford', 'Tralee'] },
    connacht: { name: 'Connacht', cities: ['Galway', 'Sligo', 'Castlebar'] },
    ulster: { name: 'Ulster', cities: ['Letterkenny', 'Cavan', 'Monaghan'] },
  },

  // --- India -----------------------------------------------------------------
  in: {
    maharashtra: { name: 'Maharashtra', cities: ['Mumbai', 'Pune', 'Nagpur', 'Nashik', 'Thane'] },
    'delhi': { name: 'Delhi', cities: ['New Delhi', 'Delhi'] },
    karnataka: { name: 'Karnataka', cities: ['Bengaluru', 'Mysuru', 'Mangaluru', 'Hubballi'] },
    'tamil-nadu': { name: 'Tamil Nadu', cities: ['Chennai', 'Coimbatore', 'Madurai', 'Tiruchirappalli'] },
    telangana: { name: 'Telangana', cities: ['Hyderabad', 'Warangal'] },
    'west-bengal': { name: 'West Bengal', cities: ['Kolkata', 'Howrah', 'Siliguri'] },
    gujarat: { name: 'Gujarat', cities: ['Ahmedabad', 'Surat', 'Vadodara', 'Rajkot'] },
    rajasthan: { name: 'Rajasthan', cities: ['Jaipur', 'Jodhpur', 'Udaipur', 'Kota'] },
    'uttar-pradesh': { name: 'Uttar Pradesh', cities: ['Lucknow', 'Kanpur', 'Noida', 'Varanasi', 'Agra'] },
    kerala: { name: 'Kerala', cities: ['Thiruvananthapuram', 'Kochi', 'Kozhikode'] },
    punjab: { name: 'Punjab', cities: ['Ludhiana', 'Amritsar', 'Jalandhar'] },
    haryana: { name: 'Haryana', cities: ['Gurugram', 'Faridabad', 'Panipat'] },
  },

  // --- Singapore (city-state) ------------------------------------------------
  sg: {
    singapore: { name: 'Singapore', cities: ['Singapore'] },
  },

  // --- Philippines -----------------------------------------------------------
  ph: {
    'metro-manila': { name: 'Metro Manila', cities: ['Manila', 'Quezon City', 'Makati', 'Taguig', 'Pasig'] },
    calabarzon: { name: 'Calabarzon', cities: ['Calamba', 'Antipolo', 'Batangas City', 'Lucena'] },
    'central-visayas': { name: 'Central Visayas', cities: ['Cebu City', 'Lapu-Lapu', 'Mandaue', 'Tagbilaran'] },
    'davao-region': { name: 'Davao Region', cities: ['Davao City', 'Tagum', 'Digos'] },
    'western-visayas': { name: 'Western Visayas', cities: ['Iloilo City', 'Bacolod', 'Roxas City'] },
    'central-luzon': { name: 'Central Luzon', cities: ['Angeles', 'San Fernando', 'Olongapo'] },
  },

  // --- Malaysia --------------------------------------------------------------
  my: {
    'kuala-lumpur': { name: 'Kuala Lumpur', cities: ['Kuala Lumpur'] },
    selangor: { name: 'Selangor', cities: ['Shah Alam', 'Petaling Jaya', 'Subang Jaya', 'Klang'] },
    penang: { name: 'Penang', cities: ['George Town', 'Butterworth', 'Bayan Lepas'] },
    johor: { name: 'Johor', cities: ['Johor Bahru', 'Iskandar Puteri', 'Batu Pahat'] },
    perak: { name: 'Perak', cities: ['Ipoh', 'Taiping'] },
    sabah: { name: 'Sabah', cities: ['Kota Kinabalu', 'Sandakan', 'Tawau'] },
    sarawak: { name: 'Sarawak', cities: ['Kuching', 'Miri', 'Sibu'] },
  },

  // --- South Africa ----------------------------------------------------------
  za: {
    gauteng: { name: 'Gauteng', cities: ['Johannesburg', 'Pretoria', 'Soweto', 'Sandton'] },
    'western-cape': { name: 'Western Cape', cities: ['Cape Town', 'Stellenbosch', 'George'] },
    'kwazulu-natal': { name: 'KwaZulu-Natal', cities: ['Durban', 'Pietermaritzburg', 'Richards Bay'] },
    'eastern-cape': { name: 'Eastern Cape', cities: ['Port Elizabeth', 'East London', 'Mthatha'] },
    limpopo: { name: 'Limpopo', cities: ['Polokwane', 'Thohoyandou'] },
    mpumalanga: { name: 'Mpumalanga', cities: ['Mbombela', 'Emalahleni'] },
    'free-state': { name: 'Free State', cities: ['Bloemfontein', 'Welkom'] },
    'north-west': { name: 'North West', cities: ['Rustenburg', 'Mahikeng'] },
    'northern-cape': { name: 'Northern Cape', cities: ['Kimberley', 'Upington'] },
  },

  // --- Nigeria ---------------------------------------------------------------
  ng: {
    lagos: { name: 'Lagos', cities: ['Lagos', 'Ikeja', 'Lekki', 'Badagry'] },
    'abuja-fct': { name: 'Federal Capital Territory', cities: ['Abuja', 'Gwagwalada'] },
    rivers: { name: 'Rivers', cities: ['Port Harcourt', 'Bonny'] },
    kano: { name: 'Kano', cities: ['Kano'] },
    oyo: { name: 'Oyo', cities: ['Ibadan', 'Ogbomosho'] },
    enugu: { name: 'Enugu', cities: ['Enugu', 'Nsukka'] },
    kaduna: { name: 'Kaduna', cities: ['Kaduna', 'Zaria'] },
  },

  // --- United Arab Emirates --------------------------------------------------
  ae: {
    'abu-dhabi': { name: 'Abu Dhabi', cities: ['Abu Dhabi', 'Al Ain'] },
    dubai: { name: 'Dubai', cities: ['Dubai'] },
    sharjah: { name: 'Sharjah', cities: ['Sharjah'] },
    ajman: { name: 'Ajman', cities: ['Ajman'] },
    'ras-al-khaimah': { name: 'Ras Al Khaimah', cities: ['Ras Al Khaimah'] },
    fujairah: { name: 'Fujairah', cities: ['Fujairah'] },
    'umm-al-quwain': { name: 'Umm Al Quwain', cities: ['Umm Al Quwain'] },
  },

  // --- Pakistan --------------------------------------------------------------
  pk: {
    punjab: { name: 'Punjab', cities: ['Lahore', 'Faisalabad', 'Rawalpindi', 'Multan', 'Gujranwala'] },
    sindh: { name: 'Sindh', cities: ['Karachi', 'Hyderabad', 'Sukkur'] },
    'khyber-pakhtunkhwa': { name: 'Khyber Pakhtunkhwa', cities: ['Peshawar', 'Mardan', 'Abbottabad'] },
    balochistan: { name: 'Balochistan', cities: ['Quetta', 'Gwadar'] },
    islamabad: { name: 'Islamabad', cities: ['Islamabad'] },
  },

  // --- Bangladesh ------------------------------------------------------------
  bd: {
    dhaka: { name: 'Dhaka', cities: ['Dhaka', 'Gazipur', 'Narayanganj'] },
    chattogram: { name: 'Chattogram', cities: ['Chattogram', "Cox's Bazar", 'Comilla'] },
    khulna: { name: 'Khulna', cities: ['Khulna', 'Jessore'] },
    rajshahi: { name: 'Rajshahi', cities: ['Rajshahi', 'Bogra'] },
    sylhet: { name: 'Sylhet', cities: ['Sylhet', 'Moulvibazar'] },
    barishal: { name: 'Barishal', cities: ['Barishal', 'Patuakhali'] },
  },

  // --- Germany ---------------------------------------------------------------
  de: {
    bayern: { name: 'Bavaria', cities: ['Munich', 'Nuremberg', 'Augsburg', 'Regensburg'] },
    'nordrhein-westfalen': { name: 'North Rhine-Westphalia', cities: ['Cologne', 'Düsseldorf', 'Dortmund', 'Essen', 'Duisburg'] },
    'baden-wuerttemberg': { name: 'Baden-Württemberg', cities: ['Stuttgart', 'Mannheim', 'Karlsruhe', 'Freiburg'] },
    berlin: { name: 'Berlin', cities: ['Berlin'] },
    hamburg: { name: 'Hamburg', cities: ['Hamburg'] },
    hessen: { name: 'Hesse', cities: ['Frankfurt', 'Wiesbaden', 'Kassel', 'Darmstadt'] },
    niedersachsen: { name: 'Lower Saxony', cities: ['Hanover', 'Braunschweig', 'Oldenburg', 'Osnabrück'] },
    sachsen: { name: 'Saxony', cities: ['Dresden', 'Leipzig', 'Chemnitz'] },
    'rheinland-pfalz': { name: 'Rhineland-Palatinate', cities: ['Mainz', 'Ludwigshafen', 'Koblenz'] },
    'schleswig-holstein': { name: 'Schleswig-Holstein', cities: ['Kiel', 'Lübeck'] },
    brandenburg: { name: 'Brandenburg', cities: ['Potsdam', 'Cottbus'] },
    'sachsen-anhalt': { name: 'Saxony-Anhalt', cities: ['Magdeburg', 'Halle'] },
    thueringen: { name: 'Thuringia', cities: ['Erfurt', 'Jena'] },
    'mecklenburg-vorpommern': { name: 'Mecklenburg-Vorpommern', cities: ['Rostock', 'Schwerin'] },
    saarland: { name: 'Saarland', cities: ['Saarbrücken'] },
    bremen: { name: 'Bremen', cities: ['Bremen', 'Bremerhaven'] },
  },

  // --- France ----------------------------------------------------------------
  fr: {
    'ile-de-france': { name: 'Île-de-France', cities: ['Paris', 'Versailles', 'Boulogne-Billancourt'] },
    'auvergne-rhone-alpes': { name: 'Auvergne-Rhône-Alpes', cities: ['Lyon', 'Grenoble', 'Saint-Étienne'] },
    'provence-alpes-cote-d-azur': { name: "Provence-Alpes-Côte d'Azur", cities: ['Marseille', 'Nice', 'Toulon', 'Avignon'] },
    occitanie: { name: 'Occitanie', cities: ['Toulouse', 'Montpellier', 'Nîmes'] },
    'nouvelle-aquitaine': { name: 'Nouvelle-Aquitaine', cities: ['Bordeaux', 'Limoges', 'Poitiers'] },
    'hauts-de-france': { name: 'Hauts-de-France', cities: ['Lille', 'Amiens', 'Roubaix'] },
    'grand-est': { name: 'Grand Est', cities: ['Strasbourg', 'Reims', 'Metz', 'Nancy'] },
    'pays-de-la-loire': { name: 'Pays de la Loire', cities: ['Nantes', 'Angers', 'Le Mans'] },
    normandie: { name: 'Normandy', cities: ['Rouen', 'Caen', 'Le Havre'] },
    bretagne: { name: 'Brittany', cities: ['Rennes', 'Brest', 'Quimper'] },
    'centre-val-de-loire': { name: 'Centre-Val de Loire', cities: ['Orléans', 'Tours'] },
    'bourgogne-franche-comte': { name: 'Bourgogne-Franche-Comté', cities: ['Dijon', 'Besançon'] },
    corse: { name: 'Corsica', cities: ['Ajaccio', 'Bastia'] },
  },

  // --- Spain -----------------------------------------------------------------
  es: {
    madrid: { name: 'Community of Madrid', cities: ['Madrid', 'Móstoles', 'Alcalá de Henares'] },
    cataluna: { name: 'Catalonia', cities: ['Barcelona', 'Girona', 'Tarragona', 'Lleida'] },
    andalucia: { name: 'Andalusia', cities: ['Seville', 'Málaga', 'Granada', 'Córdoba'] },
    'comunidad-valenciana': { name: 'Valencian Community', cities: ['Valencia', 'Alicante', 'Elche'] },
    galicia: { name: 'Galicia', cities: ['A Coruña', 'Vigo', 'Santiago de Compostela'] },
    'pais-vasco': { name: 'Basque Country', cities: ['Bilbao', 'San Sebastián', 'Vitoria-Gasteiz'] },
    'castilla-y-leon': { name: 'Castile and León', cities: ['Valladolid', 'Salamanca', 'Burgos'] },
    aragon: { name: 'Aragon', cities: ['Zaragoza', 'Huesca'] },
    murcia: { name: 'Region of Murcia', cities: ['Murcia', 'Cartagena'] },
    canarias: { name: 'Canary Islands', cities: ['Las Palmas', 'Santa Cruz de Tenerife'] },
    baleares: { name: 'Balearic Islands', cities: ['Palma', 'Ibiza'] },
    asturias: { name: 'Asturias', cities: ['Oviedo', 'Gijón'] },
  },

  // --- Italy -----------------------------------------------------------------
  it: {
    lombardia: { name: 'Lombardy', cities: ['Milan', 'Bergamo', 'Brescia', 'Monza'] },
    lazio: { name: 'Lazio', cities: ['Rome', 'Latina', 'Frosinone'] },
    campania: { name: 'Campania', cities: ['Naples', 'Salerno', 'Caserta'] },
    piemonte: { name: 'Piedmont', cities: ['Turin', 'Novara', 'Alessandria'] },
    sicilia: { name: 'Sicily', cities: ['Palermo', 'Catania', 'Messina'] },
    veneto: { name: 'Veneto', cities: ['Venice', 'Verona', 'Padua'] },
    'emilia-romagna': { name: 'Emilia-Romagna', cities: ['Bologna', 'Parma', 'Modena', 'Rimini'] },
    toscana: { name: 'Tuscany', cities: ['Florence', 'Pisa', 'Livorno', 'Siena'] },
    puglia: { name: 'Apulia', cities: ['Bari', 'Taranto', 'Lecce'] },
    liguria: { name: 'Liguria', cities: ['Genoa', 'La Spezia'] },
    calabria: { name: 'Calabria', cities: ['Catanzaro', 'Reggio Calabria'] },
    sardegna: { name: 'Sardinia', cities: ['Cagliari', 'Sassari'] },
  },

  // --- Netherlands -----------------------------------------------------------
  nl: {
    'noord-holland': { name: 'North Holland', cities: ['Amsterdam', 'Haarlem', 'Alkmaar'] },
    'zuid-holland': { name: 'South Holland', cities: ['The Hague', 'Rotterdam', 'Leiden'] },
    'noord-brabant': { name: 'North Brabant', cities: ['Eindhoven', 'Tilburg', 'Breda'] },
    utrecht: { name: 'Utrecht', cities: ['Utrecht', 'Amersfoort'] },
    gelderland: { name: 'Gelderland', cities: ['Nijmegen', 'Arnhem', 'Apeldoorn'] },
    overijssel: { name: 'Overijssel', cities: ['Enschede', 'Zwolle'] },
    groningen: { name: 'Groningen', cities: ['Groningen'] },
    friesland: { name: 'Friesland', cities: ['Leeuwarden'] },
    limburg: { name: 'Limburg', cities: ['Maastricht'] },
    drenthe: { name: 'Drenthe', cities: ['Assen'] },
    flevoland: { name: 'Flevoland', cities: ['Almere'] },
    zeeland: { name: 'Zeeland', cities: ['Middelburg'] },
  },

  // --- Japan -----------------------------------------------------------------
  jp: {
    tokyo: { name: 'Tokyo', cities: ['Tokyo', 'Hachioji', 'Machida'] },
    osaka: { name: 'Osaka', cities: ['Osaka', 'Sakai', 'Higashiosaka'] },
    kanagawa: { name: 'Kanagawa', cities: ['Yokohama', 'Kawasaki', 'Sagamihara'] },
    aichi: { name: 'Aichi', cities: ['Nagoya', 'Toyota'] },
    hokkaido: { name: 'Hokkaido', cities: ['Sapporo', 'Asahikawa'] },
    fukuoka: { name: 'Fukuoka', cities: ['Fukuoka', 'Kitakyushu'] },
    hyogo: { name: 'Hyogo', cities: ['Kobe', 'Himeji'] },
    kyoto: { name: 'Kyoto', cities: ['Kyoto'] },
    saitama: { name: 'Saitama', cities: ['Saitama', 'Kawaguchi'] },
    chiba: { name: 'Chiba', cities: ['Chiba', 'Funabashi'] },
  },

  // --- Brazil ----------------------------------------------------------------
  br: {
    'sao-paulo': { name: 'São Paulo', cities: ['São Paulo', 'Campinas', 'Santos', 'Ribeirão Preto'] },
    'rio-de-janeiro': { name: 'Rio de Janeiro', cities: ['Rio de Janeiro', 'Niterói', 'Petrópolis'] },
    'minas-gerais': { name: 'Minas Gerais', cities: ['Belo Horizonte', 'Uberlândia', 'Juiz de Fora'] },
    bahia: { name: 'Bahia', cities: ['Salvador', 'Feira de Santana'] },
    parana: { name: 'Paraná', cities: ['Curitiba', 'Londrina'] },
    'rio-grande-do-sul': { name: 'Rio Grande do Sul', cities: ['Porto Alegre', 'Caxias do Sul'] },
    pernambuco: { name: 'Pernambuco', cities: ['Recife', 'Olinda'] },
    ceara: { name: 'Ceará', cities: ['Fortaleza', 'Caucaia'] },
    'distrito-federal': { name: 'Distrito Federal', cities: ['Brasília'] },
    'santa-catarina': { name: 'Santa Catarina', cities: ['Florianópolis', 'Joinville'] },
  },

  // --- Mexico ----------------------------------------------------------------
  mx: {
    'ciudad-de-mexico': { name: 'Mexico City', cities: ['Mexico City'] },
    jalisco: { name: 'Jalisco', cities: ['Guadalajara', 'Zapopan', 'Tlaquepaque'] },
    'nuevo-leon': { name: 'Nuevo León', cities: ['Monterrey', 'Guadalupe'] },
    'estado-de-mexico': { name: 'State of Mexico', cities: ['Toluca', 'Ecatepec', 'Naucalpan'] },
    puebla: { name: 'Puebla', cities: ['Puebla', 'Tehuacán'] },
    guanajuato: { name: 'Guanajuato', cities: ['León', 'Irapuato'] },
    veracruz: { name: 'Veracruz', cities: ['Veracruz', 'Xalapa'] },
    'quintana-roo': { name: 'Quintana Roo', cities: ['Cancún', 'Playa del Carmen'] },
    yucatan: { name: 'Yucatán', cities: ['Mérida'] },
    'baja-california': { name: 'Baja California', cities: ['Tijuana', 'Mexicali'] },
  },
};
