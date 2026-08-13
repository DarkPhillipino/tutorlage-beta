export interface Institution {
  id: string;
  name: string;
  city: string;
  country: string;
  studentCount?: number;
  popularSubjects?: string[];
}

export interface Tutor {
  id: string;
  name: string;
  title: string;
  avatar: string;
  rating: number;
  reviewsCount: number;
  hourlyRate: number; // in ZAR or USD
  currency: string;
  subjects: string[];
  gradeLevels: string[];
  verifiedBadge: boolean;
  institution: string;
  availability: string;
  bio: string;
}

export interface SuggestionItem {
  id: string;
  title: string;
  description: string;
  iconName: '1-on-1' | 'scheduled' | 'homework' | 'examprep' | 'group' | 'teens';
  badge?: string;
}

export interface BookingFormState {
  institution: string;
  subject: string;
  gradeLevel: string;
  scheduleType: 'now' | 'scheduled';
  scheduledDate: string;
  scheduledTime: string;
}

export interface UserAccount {
  name: string;
  email: string;
  institution: string;
  upcomingSessions: number;
  completedSessions: number;
  savedTutorsCount: number;
}
