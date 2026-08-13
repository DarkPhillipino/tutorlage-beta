import { Institution, Tutor, SuggestionItem } from '../types';

export const INITIAL_INSTITUTION = "The IIE's Emeris Waterfall";

export const SAMPLE_INSTITUTIONS: Institution[] = [
  { id: '1', name: "The IIE's Emeris Waterfall", city: 'Midrand', country: 'ZA', studentCount: 4200, popularSubjects: ['Python', 'Maths', 'Accounting', 'Software Dev'] },
  { id: '2', name: "The IIE Varsity College Sandton", city: 'Johannesburg', country: 'ZA', studentCount: 5800, popularSubjects: ['Business Mgmt', 'Law', 'IT', 'Marketing'] },
  { id: '3', name: "University of the Witwatersrand (Wits)", city: 'Johannesburg', country: 'ZA', studentCount: 32000, popularSubjects: ['Engineering', 'Medicine', 'Computer Science', 'Finance'] },
  { id: '4', name: "University of Cape Town (UCT)", city: 'Cape Town', country: 'ZA', studentCount: 29000, popularSubjects: ['Economics', 'Data Science', 'Statistics', 'Physics'] },
  { id: '5', name: "University of Pretoria (Tuks)", city: 'Pretoria', country: 'ZA', studentCount: 35000, popularSubjects: ['Calculus', 'Chemistry', 'BCom Accounting', 'Biology'] },
  { id: '6', name: "Stellenbosch University", city: 'Stellenbosch', country: 'ZA', studentCount: 28000, popularSubjects: ['Wine Biotechnology', 'Actuarial Science', 'Mechatronics'] },
  { id: '7', name: "Tutorlage Online Global Campus", city: 'Worldwide', country: 'Global', studentCount: 150000, popularSubjects: ['Full-Stack Dev', 'AI & ML', 'IELTS / SAT', 'SAT Math'] }
];

export const POPULAR_SUBJECTS = [
  'Mathematics (Calculus & Linear Algebra)',
  'Python & Computer Science',
  'Physics & Thermodynamics',
  'Financial Accounting',
  'Data Structures & Algorithms',
  'Organic Chemistry',
  'Economics & Econometrics',
  'Academic Essay Writing & Research',
  'Biology & Human Anatomy',
  'Statistics & Probability',
  'Machine Learning & AI Basics',
  'High School Physical Science'
];

export const POPULAR_GRADE_LEVELS = [
  'High School (Grades 10 - 12)',
  '1st Year Undergraduate',
  '2nd & 3rd Year Undergraduate',
  'Postgraduate / Honors',
  'High School (Grades 8 - 9)',
  'Adult / Career Switcher'
];

export const SUGGESTIONS_LIST: SuggestionItem[] = [
  {
    id: '1-on-1',
    title: '1-on-1 Tutoring',
    description: 'Personalized live instruction tailored to your specific pace & syllabus.',
    iconName: '1-on-1',
    badge: 'Popular'
  },
  {
    id: 'scheduled',
    title: 'Scheduled Sessions',
    description: 'Book ahead for weekly recurring study blocks with top verified mentors.',
    iconName: 'scheduled'
  },
  {
    id: 'homework',
    title: 'Homework Help',
    description: 'Get step-by-step guidance on assignments, code reviews, and labs.',
    iconName: 'homework'
  },
  {
    id: 'examprep',
    title: 'Exam Prep',
    description: 'Targeted past-paper drills, crash courses, and exam strategy reviews.',
    iconName: 'examprep',
    badge: 'High Impact'
  },
  {
    id: 'group',
    title: 'Group Classes',
    description: 'Collaborative peer workshops with max 6 students per session.',
    iconName: 'group'
  },
  {
    id: 'teens',
    title: 'Kids & Teens',
    description: 'Engaging, safe foundational tutoring for secondary school learners.',
    iconName: 'teens'
  }
];

export const MOCK_TUTORS: Tutor[] = [
  {
    id: 't1',
    name: 'Dr. Thabo Molefe',
    title: 'Senior Mathematics & Python Lecturer',
    avatar: 'https://images.unsplash.com/photo-1534528741775-53994a69daeb?auto=format&fit=crop&q=80&w=250',
    rating: 4.96,
    reviewsCount: 142,
    hourlyRate: 280,
    currency: 'ZAR',
    subjects: ['Mathematics (Calculus & Linear Algebra)', 'Python & Computer Science', 'Data Structures & Algorithms'],
    gradeLevels: ['1st Year Undergraduate', '2nd & 3rd Year Undergraduate', 'Postgraduate / Honors'],
    verifiedBadge: true,
    institution: "The IIE's Emeris Waterfall",
    availability: 'Available Today • Next slot 14:00',
    bio: 'Former IIE Dean Scholar with 7+ years mentoring undergrads in higher mathematics and computational algorithms.'
  },
  {
    id: 't2',
    name: 'Sarah Jenkins, MSc',
    title: 'Computer Science & Software Engineering Specialist',
    avatar: 'https://images.unsplash.com/photo-1573496359142-b8d87734a5a2?auto=format&fit=crop&q=80&w=250',
    rating: 4.98,
    reviewsCount: 215,
    hourlyRate: 320,
    currency: 'ZAR',
    subjects: ['Python & Computer Science', 'Machine Learning & AI Basics', 'Data Structures & Algorithms'],
    gradeLevels: ['1st Year Undergraduate', '2nd & 3rd Year Undergraduate', 'High School (Grades 10 - 12)'],
    verifiedBadge: true,
    institution: "The IIE's Emeris Waterfall",
    availability: 'Available in 15 mins',
    bio: 'Lead Full-Stack Developer & IIE Tutor of the Year. Specialist in demystifying OOP, Python, and web stack fundamentals.'
  },
  {
    id: 't3',
    name: 'Kagiso Dlamini',
    title: 'Financial Accounting & Economics Mentor',
    avatar: 'https://images.unsplash.com/photo-1507003211169-0a1dd7228f2d?auto=format&fit=crop&q=80&w=250',
    rating: 4.89,
    reviewsCount: 98,
    hourlyRate: 250,
    currency: 'ZAR',
    subjects: ['Financial Accounting', 'Economics & Econometrics', 'Statistics & Probability'],
    gradeLevels: ['High School (Grades 10 - 12)', '1st Year Undergraduate'],
    verifiedBadge: true,
    institution: "The IIE's Emeris Waterfall",
    availability: 'Available Tomorrow 09:00',
    bio: 'BCom Cum Laude graduate helping students master financial statements, balance sheets, and microeconomics.'
  },
  {
    id: 't4',
    name: 'Anika Patel',
    title: 'Physics & Chemistry Specialist',
    avatar: 'https://images.unsplash.com/photo-1580489944761-15a19d654956?auto=format&fit=crop&q=80&w=250',
    rating: 4.94,
    reviewsCount: 167,
    hourlyRate: 290,
    currency: 'ZAR',
    subjects: ['Physics & Thermodynamics', 'Organic Chemistry', 'High School Physical Science'],
    gradeLevels: ['High School (Grades 10 - 12)', '1st Year Undergraduate'],
    verifiedBadge: true,
    institution: "The IIE's Emeris Waterfall",
    availability: 'Available Today • Next slot 16:30',
    bio: 'Passionate STEM educator breaking down complex physics formulas and chemical reaction mechanisms into intuitive steps.'
  },
  {
    id: 't5',
    name: 'Lethabo Nxumalo',
    title: 'Academic Writing, Research & Essay Coach',
    avatar: 'https://images.unsplash.com/photo-1531746020798-e6953c6e8e04?auto=format&fit=crop&q=80&w=250',
    rating: 4.92,
    reviewsCount: 84,
    hourlyRate: 220,
    currency: 'ZAR',
    subjects: ['Academic Essay Writing & Research', 'Economics & Econometrics'],
    gradeLevels: ['High School (Grades 10 - 12)', '1st Year Undergraduate', 'Postgraduate / Honors'],
    verifiedBadge: true,
    institution: "The IIE's Emeris Waterfall",
    availability: 'Available Today • Next slot 18:00',
    bio: 'Published academic author guiding students on citation styles (APA/Harvard), structuring theses, and proofreading.'
  }
];
