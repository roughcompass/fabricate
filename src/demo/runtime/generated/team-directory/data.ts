export interface Person {
  id: string;
  name: string;
  role: string;
  team: string;
  location: string;
  /** Local time when the directory was loaded, with its zone. */
  localTime: string;
  manager: string;
  joined: string;
  /** Joined in the last 90 days, so onboarding is still open. */
  joiner: boolean;
  skills: readonly string[];
}

export interface OnboardingTask {
  id: string;
  label: string;
  due: string;
  done: boolean;
}

export const SKILLS: readonly string[] = ["React", "TypeScript", "Java", "Python", "Kafka", "AWS", "Accessibility", "Design systems"];

export const PEOPLE: readonly Person[] = [
  { id: "amelia-hart", name: "Amelia Hart", role: "Front-end engineer", team: "Digital channels", location: "London", localTime: "14:30 GMT", manager: "Lena Fischer", joined: "5 Oct 2026", joiner: true, skills: ["React", "TypeScript", "Accessibility"] },
  { id: "kwame-mensah", name: "Kwame Mensah", role: "Platform engineer", team: "Cloud platform", location: "Glasgow", localTime: "14:30 GMT", manager: "Noah Williams", joined: "3 Jun 2019", joiner: false, skills: ["AWS", "Kafka", "Python"] },
  { id: "sofia-marques", name: "Sofia Marques", role: "Product designer", team: "Design systems", location: "Lisbon", localTime: "14:30 WET", manager: "Lena Fischer", joined: "12 Oct 2026", joiner: true, skills: ["Design systems", "Accessibility", "React"] },
  { id: "ethan-brooks", name: "Ethan Brooks", role: "Data engineer", team: "Risk data", location: "New York", localTime: "09:30 ET", manager: "Grace Liu", joined: "18 Jan 2021", joiner: false, skills: ["Python", "Kafka", "AWS"] },
  { id: "lena-fischer", name: "Lena Fischer", role: "Engineering manager", team: "Digital channels", location: "Frankfurt", localTime: "15:30 CET", manager: "Hannah Okafor", joined: "9 Apr 2018", joiner: false, skills: ["Java", "React", "TypeScript"] },
  { id: "arjun-mehta", name: "Arjun Mehta", role: "Back-end engineer", team: "Payments", location: "Bengaluru", localTime: "20:00 IST", manager: "Grace Liu", joined: "28 Sep 2026", joiner: true, skills: ["Java", "Kafka", "AWS"] },
  { id: "grace-liu", name: "Grace Liu", role: "Engineering lead", team: "Payments", location: "Singapore", localTime: "22:30 SGT", manager: "Hannah Okafor", joined: "7 Mar 2022", joiner: false, skills: ["Java", "TypeScript", "Accessibility"] },
  { id: "noah-williams", name: "Noah Williams", role: "Site reliability engineer", team: "Cloud platform", location: "New York", localTime: "09:30 ET", manager: "Hannah Okafor", joined: "14 Sep 2020", joiner: false, skills: ["AWS", "Python", "Kafka"] },
];

/** Onboarding checklists for new joiners. */
export const CHECKLISTS: Readonly<Record<string, readonly OnboardingTask[]>> = {
  "amelia-hart": [
    { id: "laptop", label: "Collect laptop and security key", due: "5 Oct 2026", done: true },
    { id: "accounts", label: "Activate network and email accounts", due: "5 Oct 2026", done: true },
    { id: "training", label: "Complete code of conduct training", due: "9 Oct 2026", done: true },
    { id: "repos", label: "Request access to team repositories", due: "12 Oct 2026", done: true },
    { id: "buddy", label: "Meet onboarding buddy", due: "16 Oct 2026", done: false },
    { id: "release", label: "Ship a first change to production", due: "30 Oct 2026", done: false },
  ],
  "sofia-marques": [
    { id: "laptop", label: "Collect laptop and security key", due: "12 Oct 2026", done: true },
    { id: "accounts", label: "Activate network and email accounts", due: "12 Oct 2026", done: true },
    { id: "training", label: "Complete code of conduct training", due: "16 Oct 2026", done: false },
    { id: "figma", label: "Join the design system workspace", due: "16 Oct 2026", done: false },
    { id: "buddy", label: "Meet onboarding buddy", due: "23 Oct 2026", done: false },
  ],
  "arjun-mehta": [
    { id: "laptop", label: "Collect laptop and security key", due: "28 Sep 2026", done: true },
    { id: "accounts", label: "Activate network and email accounts", due: "28 Sep 2026", done: true },
    { id: "training", label: "Complete code of conduct training", due: "2 Oct 2026", done: true },
    { id: "repos", label: "Request access to team repositories", due: "5 Oct 2026", done: true },
    { id: "buddy", label: "Meet onboarding buddy", due: "9 Oct 2026", done: true },
    { id: "oncall", label: "Shadow an on-call shift", due: "23 Oct 2026", done: false },
  ],
};
