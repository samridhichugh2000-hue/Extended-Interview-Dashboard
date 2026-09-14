// Manager name -> email lookup. Koenig sync only gives us a manager name
// (employees.manager) — no manager email — so this is a manually maintained
// directory to resolve one from the other. Matching is case/whitespace
// insensitive since manager name casing varies by source system.

const MANAGER_EMAILS = {
  'Shiv Sompati': 'Shiv.Sompati@koenig-solutions.com',
  'Jasmeet Kaur': 'jasmeet.kaur@koenig-solutions.com',
  'Rohit Aggarwal': 'rohit.a@koenig-solutions.com',
  'Pooja Chauhan': 'pooja.chauhan@koenig-solutions.com',
  'Akshay Kumar': 'akshay.kumar@koenig-solutions.com',
  'Vaibhav Gupta': 'vaibhav.gupta1@koenig-solutions.com',
  'Akash Mehndiratta': 'akash.mehndiratta@koenig-solutions.com',
  'Sakshi Nagpal': 'Sakshi.Nagpal@koenig-solutions.com',
  'Shaheen Khan': 'Shaheen.khan@koenig-solutions.com',
  'Rimpy Srivastava': 'rimpy.srivastava@koenig-solutions.com',
  'Shruti Chhabra': 'Shruti.Chhabra@koenig-solutions.com',
  'Vibhor Raju Sharma': 'Vibhor.Sharma@koenig-solutions.com',
  'Nidhi Karthik Nayak': 'Nidhi.Nayak@koenig-solutions.com',
  'Tanya Jaiswal': 'Tanya.Jaiswal@koenig-solutions.com',
  'Dinesh Kumar Jha': 'dan@koenig-solutions.com',
  'Vaibhav Prakash': 'Vaibhav.Prakash@koenig-solutions.com',
  'Abhishek Soni': 'abhishek.soni@koenig-solutions.com',
  'Palak Kalra': 'Palak.Kalra@koenig-solutions.com',
  'Arshad Khaja Qureshi': 'Arshad.Qureshi@koenig-solutions.com',
  'Rashmi Amol Dhumal': 'Rashmi.Dhumal@koenig-solutions.com',
  'Vatan Vijaykumar Joshi': 'vatan.joshi@koenig-solutions.com',
  'Rashi Oberoi': 'rashi.oberoi@koenig-solutions.com',
  'Subodh Kumar Chaudhary': 'subodh.chaudhary@koenig-solutions.com',
  'Hardik Tike': 'hardik.tike@koenig-solutions.com',
  'Rishika Tibarewala': 'rishika.tibarewala@koenig-solutions.com',
  'Sachin Chauhan': 'sachin.chauhan@koenig-solutions.com',
  'Shubham Saha': 'Shubham.Saha@koenig-solutions.com',
  'Sandeep Joshi': 'Sandeep.Joshi@koenig-solutions.com',
  'Deepti Shastri': 'Deepti.Shastri@koenig-solutions.com',
  'Prashant Ranjan': 'prashant.ranjan@koenig-solutions.com',
  'Tarseel Kazmi': 'Tarseel.Kazmi@koenig-solutions.com',
  'Karishma Talreja': 'karishma.talreja@koenig-solutions.com',
  'Ashwin Sam Koshy': 'Ashwin.koshy@koenig-solutions.com',
  'Pooja Maheshwari': 'Pooja.Maheshwari@koenig-solutions.com',
  'Sandeep Singh': 'sandeep.singh@koenig-solutions.com',
  'Manish Chaturvedi': 'manish.chaturvedi@koenig-solutions.com',
  'Vandana Kurichh': 'Vandana.Kurichh@koenig-solutions.com',
  'Raushan Ranjan': 'Raushan.Ranjan@koenig-solutions.com',
  'Divya R': 'Divya.R@koenig-solutions.com',
  'Anirudh Sharma': 'Anirudh.Sharma@koenig-solutions.com',
  'Sania Mutreja': 'Sania.Mutreja@koenig-solutions.com',
  'Prabhat Singh': 'prabhat.singh@koenig-solutions.com',
  'Kannan Manoharan': 'Kannan.Manoharan@koenig-solutions.com',
  'Arshad Kamal': 'Arshad.Kamal@koenig-solutions.com',
  'Dinesh Ghanshyam Tiwari': 'Dinesh.Tiwari@koenig-solutions.com',
  'Vivek M Menon': 'Vivek.Menon@koenig-solutions.com',
  'Aishwar Nigam': 'Aishwar.C@koenig-solutions.com',
  'Gaurav Kumar Joshi': 'gaurav.joshi@koenig-solutions.com',
  'Saurabh Banerjee': 'saurabh.banerjee@koenig-solutions.com',
  'Vardaan Aggarwal': 'vardaan.aggarwal@koenig-solutions.com',
  'Imran Ali Mr': 'Imran.Ali@koenig-solutions.com',
  'Bhargavi Bhimavarapu': 'Bhargavi.Bhimavarapu@koenig-solutions.com',
  'Kajal Bhagvandas Ramnani': 'Kajal.Ramnani@koenig-solutions.com',
  'Sakshi Gaba Dhawan': 'sakshi.dhawan@koenig-solutions.com',
  'Sushma Sharma': 'Sushma.Sharma@koenig-solutions.com',
  'Kannan S': 'Kannan.Sudhakaran@koenig-solutions.com',
  'Rohit Tiwary': 'Rohit.Tiwary@koenig-solutions.com',
  'Megha Jain': 'megan@koenig-solutions.com',
  'Mokshi Puri': 'Mokshi.Puri@koenig-solutions.com',
  'Shifali Sharma': 'Shifali.Sharma@koenig-solutions.com',
  'Rupali Chaubey': 'Rupali.Chaubey@koenig-solutions.com',
  'Kunal Singh': 'Kunal.Singh@koenig-solutions.com',
  'Sagnik Ghosh': 'Sagnik.Ghosh@koenig-solutions.com',
  'Sushil Kumar Pandey': 'Sushil.Kumar@koenig-solutions.com',
  'Deepanshu Kumar': 'DEEPANSHU.KUMAR@koenig-solutions.com',
  'Aditya Sharma': 'aditya.sharma@koenig-solutions.com',
  'Subhendu Mukherjee': 'subhendu.mukherjee@koenig-solutions.com',
  'Akwinder Kaur': 'Akwinder.Kaur@koenig-solutions.com',
  'Dhanya Kumar Singh': 'dhanya.singh@koenig-solutions.com',
  'Raahil Aggarwal': 'Raahil.aggarwal@koenig-solutions.com',
  'Nidhi Kumra Ahuja': 'nidhi.kumra@koenig-solutions.com',
  'Anish Samy': 'Anish.Samy@koenig-solutions.com',
  'Rahul Babarao Khadase': 'Rahul.Khadase@koenig-solutions.com',
  'Krishna Ramlolarakh Dwivedi': 'Krishna.Dwivedi@koenig-solutions.com',
  'Praveen Kumar': 'praveen.kumar@koenig-solutions.com',
  'Neha Shah': 'jessica@koenig-solutions.com',
  'Priyanka Goyal': 'Stella.Watson@koenig-solutions.com',
  'Damini Sabharwal': 'Damini.Sabharwal@koenig-solutions.com',
  'Sunil Sharma': 'Sunil.Sharma@koenig-solutions.com',
  'Saroj Mala': 'saroj.mala@koenig-solutions.com',
  'Sarika Gupta': 'Sarika.Gupta@koenig-solutions.com',
  'Nishant Yash': 'Nishant.Yash@koenig-solutions.com',
  'Tamanna Alisha': 'Tamanna.Alisha@koenig-solutions.com',
  'Shuganya Sachdeva': 'Shuganya.Sachdeva@koenig-solutions.com',
  'Nupur Munjal': 'nupur.munjal@koenig-solutions.com',
  'Abhishek Vidiyala': 'Abhishek.vidiyala@koenig-solutions.com',
  'Anurag Singh Chauhan': 'anurag.chauhan@koenig-solutions.com',
  'Manish Kumar': 'manish.kumar@koenig-solutions.com',
  'Micky Mowar': 'micky.mowar@koenig-solutions.com',
  'Sunil Kumar Kushwaha': 'Sunilkumar.kushwaha@koenig-solutions.com',
  'Karan Lakhina': 'karan.lakhina@koenig-solutions.com',
  'Vipin Nautiyal': 'Vipin.Nautiyal@koenig-solutions.com',
  'Nancy': 'nancy@koenig-solutions.com',
  'Kuldeep Singh': 'Kuldeep.Singh@koenig-solutions.com',
  'Mohsin Afzal Bhat': 'Mohsin.Afzal@koenig-solutions.com',
  'Ritik Chadha': 'ritik.chadha@koenig-solutions.com',
  'Roohi Belur Raheem': 'roohi.raheem@koenig-solutions.com',
  'Sana Sadiq Pathan': 'Sana.Williams@koenig-solutions.com',
  'Tanvi Sareen': 'tanvi.sareen@koenig-solutions.com',
};

// Koenig's New Joiners feed sometimes reports only a manager's first name
// (e.g. "Sandeep" instead of "Sandeep Singh") — a source-data gap, confirmed
// by cross-referencing the Manager Feedback feed's full names for real
// employees, not a parsing issue on our side. Where that first name is
// ambiguous against MANAGER_EMAILS (more than one manager shares it), guessing
// would risk CC'ing the wrong person, so those are resolved explicitly here
// rather than left to fall through to the general fallback below.
const AMBIGUOUS_FIRST_NAME_ALIASES = {
  abhishek: 'abhishek.soni@koenig-solutions.com', // vs. Abhishek Vidiyala — confirmed via HR
  nidhi: 'nidhi.kumra@koenig-solutions.com', // vs. Nidhi Karthik Nayak — confirmed via manager-feedback cross-check
  sandeep: 'sandeep.singh@koenig-solutions.com', // vs. Sandeep Joshi — confirmed via manager-feedback cross-check
};

const emailByNormalizedName = new Map(
  Object.entries(MANAGER_EMAILS).map(([name, email]) => [normalize(name), email])
);

// name -> [firstWord, lastWord] for every directory entry, used by the
// truncated-name fallback below.
const directoryTokens = Object.entries(MANAGER_EMAILS).map(([name, email]) => {
  const words = normalize(name).split(' ');
  return { first: words[0], last: words[words.length - 1], email };
});

function normalize(name) {
  return (name || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

export function getManagerEmail(managerName) {
  const key = normalize(managerName);
  if (!key) return null;

  const exact = emailByNormalizedName.get(key);
  if (exact) return exact;

  if (AMBIGUOUS_FIRST_NAME_ALIASES[key]) return AMBIGUOUS_FIRST_NAME_ALIASES[key];

  // Koenig occasionally drops a middle name ("Hardik Ankush Tike" -> directory
  // has "Hardik Tike") or reports only a first name ("Prashant" -> directory
  // has "Prashant Ranjan"). Match on first+last word, but only when exactly
  // one directory entry qualifies — an ambiguous partial match is treated as
  // unresolved (null) rather than guessed.
  const words = key.split(' ');
  const first = words[0];
  const last = words[words.length - 1];
  const candidates = directoryTokens.filter((d) => d.first === first && (words.length === 1 || d.last === last));
  return candidates.length === 1 ? candidates[0].email : null;
}
