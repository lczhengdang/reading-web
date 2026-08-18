/* Curate raw articles: explicit keep-list (current fetch set) */
const fs = require('fs');
const path = require('path');
const root = path.join(__dirname, '..');
const d = path.join(root, 'data', 'articles-raw');

const KEEP = [
  // 科学
  'astronomy-discovery-new-cosmic-object-black-hole-star',
  'block-export-of-national-treasure-uk-fossils-says-mp',
  'mummified-human-remains-trade-health-warning-curse',
  'organoids-human-organs-cambridge-shift-drug-testing-medicines-animals',
  'roman-shipwreck-with-500-amphorae-found-off-coast-of-sicily',
  'science-or-fiction-shadowy-paper-mills-let-you-pay-to-be-a-published-author-of-fraudulent-research',
  'scientists-young-universe-moon-dark-side-cosmocube-satellite-radio-signal-21cm-line',
  'high-earners-savings-weight-loss-drugs-income-glp-1',
  'europe-solar-eclipse-best-place-to-see-it-how-to-view-safely',
  // 科技
  'ai-agents-arent-legally-responsible-for-any-harm-that-they-cause-experts-say-so-who-is',
  'ai-job-destruction',
  'ai-will-do-more-to-boost-fossil-fuel-production-than-green-energy',
  'are-microsofts-ai-plans-being-held-back-by-a-shortage-of-chips',
  'bernie-sanders-ai-development-pause-letter',
  'claude-watermark-ai-text-quality-worse',
  'flock-safety-police-abuse-surveillance-cameras',
  'mark-zuckerberg-superintelligent-ai-essay-meta',
  'meta-child-safety-google-executives-ai-techscape',
  'meta-glasses-banned-from-courts-in-england-and-wales',
  'nvidia-wall-street-finance-ai-infrastructure',
  'spotify-label-ai-artists-block-them-from-some-playlists',
  'taiwan-ai-assisted-cyber-attacks-overseas',
  'uk-companies-cyber-attack-third-jlr',
  'uk-ireland-booksellers-suspect-ai-companies-bulk-orders-data-acquisition',
  'smart-glasses-controversy-sidelines-the-benefits-for-disabled-people',
  // 环境
  '3m-knew-for-more-than-50-years-that-its-products-could-harm-humans-australian-government-alleges-in-court-documents',
  'andy-burnham-climate-response-drought-hit-farmers-labour-pressure',
  'burnham-temporary-ban-barbecues-tinderbox-britain',
  'european-farmers-unprecedented-crisis-successive-heatwaves',
  'florida-sea-turtle-nests-endangered-species',
  'gen-z-flocks-to-birdtok-as-birding-takes-flight-its-a-craving-for-something-real',
  'how-england-summer-heatwave-affecting-farm-animals-crops',
  'iberian-orca-known-for-ramming-boats-seen-with-suspected-gunshot-wounds',
  'marine-heatwave-new-normal-britain-seas',
  'reservoirs-england-wales-exceptionally-low-water-drought',
  'spotlight-on-un-cop17-desertification-summit-mongolia',
  'stourbridge-wildfires-climate-change',
  'the-great-barrier-reef-isnt-dead-yet-according-to-news-corp-that-makes-climate-science-a-pseudo-religion',
  'uk-government-emergency-drought-plans-transparency',
  // 经济
  'andy-burnham-gig-economy-companies-employment-rights',
  'china-economy-slowdown-signs-extending',
  'delivery-drivers-will-get-a-minimum-wage-in-australias-world-first-deal-but-is-it-fair-and-will-your-uber-eats-cost-more',
  'government-borrowing-costs-highs-inflation-france-germany-us-japan-uk-bond-yields',
  'humiliated-sainsburys-store-pauses-ai-scanning-after-false-shoplifting-accusation',
  'interest-rate-dilemma-for-central-banks-as-inflation-rises-but-growth-slows',
  'john-lewis-boss-peter-ruis-department-store-chain',
  'jp-morgan-boss-jamie-dimon-warns-uk-chancellor-windfall-tax-banks',
  'new-uk-cost-of-living-crisis-looms-rising-energy-bills-inflation',
  'plymouth-university-spinout-water-quality-app-uk-us-waters-molendotech-e-coli',
  'summer-jobs-bounce-back-in-uk-thanks-to-busy-calendar-of-sport-and-music',
  'tourism-power-generation-productivity-europe-economic-cost-heatwaves',
  'trump-big-beautiful-bill-millionaires',
  'uk-ev-battery-gigafactory-aesc-jaguar-land-rover-nissan',
  'uk-productivity-data-rachel-reeves-national-statistician',
  'virgin-trains-services-to-europe-eurostar',
  'water-companies-england-and-wales-explore-surge-pricing-bills-drought',
  // 教育
  'cambridge-professor-jason-arday-resigns-amid-accusations-of-plagiarism',
  'england-a-level-results-record-levels-regional-disparities',
  'government-piling-debt-on-to-future-graduates-in-england-analysis-finds',
  'inside-court-england-parents-face-fines-school-absence',
  'neuroscientist-screen-use-schools-educational-technology-jared-cooney-horvath',
  'students-new-records-a-levels-grades-results',
  'students-squeezed-out-university-courses-bumper-crop-top-a-level-grades',
  'uk-universities-face-financial-crisis-amid-collapse-in-international-students',
  'university-cambridge-whistleblower-wyn-evans-wins-employment-tribunal',
  'nerves-and-joy-as-students-collect-their-a-level-results',
  // 社会
  'a-quarter-of-young-africans-believe-usaid-cuts-could-be-positive-survey-finds',
  'african-armyworm-crop-pest-discovery-fungus-science-hope-farmers',
  'ai-cheating-leaked-papers-marking-errors-how-exam-protests-went-global',
  'bikes-city-of-cycling-gender-barriers-colombias-capital-bogota-emissions',
  'cervical-screening-bus-nhs-clinic-on-wheels-saving-lives',
  'cockroach-protests-parents-of-indian-students-who-took-their-own-lives-reveal-pressure-of-leaked-exam-papers-and-resits',
  'dangerously-hostile-heatwaves-leave-hospital-wards-unsafe-data-reveals',
  'ebola-outbreak-in-drc-the-fastest-growing-in-the-history-of-the-virus',
  'hiv-aids-trans-activists-fear-rolling-back-progress',
  'how-viable-are-burnhams-plans-to-free-up-prison-space',
  'jenrick-cuts-benefits-disabled-people-foreign-nationals',
  'peruvian-cardinal-historic-milestone-150m-lead-poisoning-settlement-1300-children',
  'porto-alegre-brazil-2024-floods-el-nino-climate-crisis-injustice',
  'rain-festival-indian-farmers-super-el-nino-raja-odisha',
  'senegal-st-louis-talibes-quran-children-forced-beg-human-trafficking-rights',
  'special-needs-internships-youth-jobs-crisis-milburn-review',
  'unemployed-young-people-to-join-ai-boot-camps-to-get-job-ready',
  'mother-daughter-music-violin-health-ms-multiple-sclerosis',
  // 政治
  'andy-burnham-barnsley-voters-labour-reform-uk-red-wall',
  'angela-rayner-pubs-developers-houses-offices-planning-shakeup',
  'british-widow-joyce-thomas-sweden-deported-brexit-policy',
  'loosening-planning-rules-england-more-homes-train-stations-rayner',
  'nigel-farage-wins-clacton-byelection-count-binface-boycotted-major-parties',
  'post-brexit-rights-british-citizens-sweden-removal-orders-analysis',
  'reform-uk-richard-tice-stop-tackling-climate-crisis-enjoy-heat',
  'standards-watchdog-investigation-nigel-farage-financial-gifts',
  'why-is-andy-burnham-so-reluctant-to-talk-about-climate-crisis',
  'yvette-cooper-labour-keir-starmer-andy-burnham',
  // 文化
  'barack-obama-launches-podcast-about-books-that-shaped-his-worldview',
  'conversations-with-an-executioner-a-chilling-classic-reveals-the-mind-of-a-nazi-mass-murderer',
  'directors-embracing-ai-film-making',
  'ej-swift-wins-the-2026-arthur-c-clarke-award-for-science-fiction',
  'feel-the-burn-why-holidays-from-hell-make-for-blistering-fiction',
  'gaza-doctor-documentary',
  'i-give-you-my-silence-by-mario-vargas-llosa-review-nobel-laureates-final-novel-is-a-love-letter-to-peru',
  'iris-murdoch-artworks-secret-room-self-portrait-novelist',
  'the-odyssey-readers-homer-epic-poetry-classics-christopher-nolan-film',
  'we-know-sleep-exercise-and-diet-are-vital-for-health-but-why',
  'you-wont-get-free-of-it-by-rachel-aviv-review-a-subtle-study-of-the-mother-daughter-bond',
  'a-history-of-the-novel-in-britain-by-philip-hensher-review-a-masterpiece-of-criticism'
];

const keepSet = new Set(KEEP);
let kept = 0, deleted = 0;
const missing = [];
fs.readdirSync(d).filter(f => f.endsWith('.json')).forEach(f => {
  const a = JSON.parse(fs.readFileSync(path.join(d, f), 'utf8'));
  const key = String(a.id).replace(/^gua-\d{4}-/, '');
  if (keepSet.has(key)) { kept++; }
  else { fs.unlinkSync(path.join(d, f)); deleted++; }
});
KEEP.forEach(n => {
  const exists = fs.readdirSync(d).some(f => String(JSON.parse(fs.readFileSync(path.join(d, f), 'utf8')).id).replace(/^gua-\d{4}-/, '') === n);
  if (!exists) missing.push(n);
});
if (missing.length) console.log('MISSING:', missing);
console.log('kept:', kept, '| deleted:', deleted);
