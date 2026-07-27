export type Category =
  | "delegation-and-workflows"
  | "research-and-interaction"
  | "continuity-and-recovery"
  | "terminal-workspace"
  | "skills-and-productivity";

export interface Capability {
  slug: string;
  category: Category;
  en: { displayName: string; benefit: string };
  id: { displayName: string; benefit: string };
  sourcePaths: string[];
  sourceLinks: { text: string; url: string }[];
  guideRoute: string;
  piComparison: "core-differentiator" | "bundled" | "ergonomic" | "reference";
}

const repo = "https://github.com/SelesaiInTech/selesai-code/blob/main";

const links = (label: string, path: string) => ({
  text: label,
  url: `${repo}/${path}`,
});

export const categories: { id: Category; en: string; indonesian: string }[] = [
  { id: "delegation-and-workflows", en: "Delegation and workflows", indonesian: "Delegasi dan alur kerja" },
  { id: "research-and-interaction", en: "Research and interaction", indonesian: "Riset dan interaksi" },
  { id: "continuity-and-recovery", en: "Continuity and recovery", indonesian: "Kontinuitas dan pemulihan" },
  { id: "terminal-workspace", en: "Terminal workspace", indonesian: "Ruang kerja terminal" },
  { id: "skills-and-productivity", en: "Skills and productivity", indonesian: "Skill dan produktivitas" },
];

export const capabilities: Capability[] = [
  {
    slug: "pi-subagents",
    category: "delegation-and-workflows",
    en: { displayName: "Subagent delegation", benefit: "Run focused in-tree agent roles in foreground, background, parallel, or chained modes with tooling and model controls." },
    id: { displayName: "Delegasi subagent", benefit: "Jalankan peran agent yang fokus secara in-tree dalam mode foreground, background, paralel, atau berantai dengan kontrol tooling dan model." },
    sourcePaths: ["src/extensions/pi-subagents/", "README.md"],
    sourceLinks: [
      links("Extension source", "src/extensions/pi-subagents/"),
      links("README mention", "README.md"),
    ],
    guideRoute: "capabilities/delegation/pi-subagents",
    piComparison: "core-differentiator",
  },
  {
    slug: "workflow",
    category: "delegation-and-workflows",
    en: { displayName: "Durable workflows", benefit: "Resumeable, stateful project workflows across prototype, quick, and task modes with explicit lifecycle management." },
    id: { displayName: "Workflow tahan lama", benefit: "Alur kerja proyek yang stateful dan dapat dilanjutkan kembali dengan mode prototype, quick, dan task serta manajemen siklus hidup eksplisit." },
    sourcePaths: ["src/extensions/workflow/", "README.md"],
    sourceLinks: [
      links("Workflow source", "src/extensions/workflow/"),
      links("README mention", "README.md"),
    ],
    guideRoute: "capabilities/delegation/workflow",
    piComparison: "core-differentiator",
  },
  {
    slug: "pi-web-agent",
    category: "research-and-interaction",
    en: { displayName: "Web research", benefit: "Single `web_explore` research tool with bounded search, fetch, source ranking, and headless-browser escalation." },
    id: { displayName: "Riset web", benefit: "Satu peralatan `web_explore` untuk riset dengan pencarian terbatas, fetch, peringkat sumber, dan eskalasi headless browser." },
    sourcePaths: ["src/extensions/pi-web-agent/", "README.md"],
    sourceLinks: [
      links("Web agent source", "src/extensions/pi-web-agent/"),
      links("README mention", "README.md"),
    ],
    guideRoute: "capabilities/research/web-agent",
    piComparison: "bundled",
  },
  {
    slug: "question",
    category: "research-and-interaction",
    en: { displayName: "Interactive questions", benefit: "TUI for single, multi-select, freeform, and image/info questions with keyboard navigation and filtering." },
    id: { displayName: "Pertanyaan interaktif", benefit: "TUI untuk pertanyaan single/multi-select, freeform, dan image/info dengan navigasi keyboard dan filtering." },
    sourcePaths: ["src/extensions/question/", "README.md"],
    sourceLinks: [
      links("Question source", "src/extensions/question/"),
      links("README mention", "README.md"),
    ],
    guideRoute: "capabilities/research/question",
    piComparison: "bundled",
  },
  {
    slug: "grep-app",
    category: "research-and-interaction",
    en: { displayName: "Public code search", benefit: "Search GitHub code through grep.app and fetch matching source without leaving the agent." },
    id: { displayName: "Pencarian kode publik", benefit: "Cari kode GitHub melalui grep.app dan ambil source yang cocok tanpa meninggalkan agent." },
    sourcePaths: ["src/extensions/grep-app/", "README.md"],
    sourceLinks: [
      links("grep.app source", "src/extensions/grep-app/"),
      links("README mention", "README.md"),
    ],
    guideRoute: "capabilities/research/grep-app",
    piComparison: "bundled",
  },
  {
    slug: "pi-intercom",
    category: "continuity-and-recovery",
    en: { displayName: "Session coordination", benefit: "Local 1:1 session messaging, ask/reply, and attachments between named Selesai sessions." },
    id: { displayName: "Koordinasi sesi", benefit: "Pesan lokal 1:1 antar sesi Selesai yang diberi nama, ask/reply, dan lampiran." },
    sourcePaths: ["src/extensions/pi-intercom/", "README.md"],
    sourceLinks: [
      links("Intercom source", "src/extensions/pi-intercom/"),
      links("README mention", "README.md"),
    ],
    guideRoute: "capabilities/continuity/intercom",
    piComparison: "bundled",
  },
  {
    slug: "undo",
    category: "continuity-and-recovery",
    en: { displayName: "Turn-level undo", benefit: "Undo tracked edits, writes, and detected mutating shell commands one turn at a time." },
    id: { displayName: "Undo per turn", benefit: "Batalkan edit, write, dan shell command bermutasi yang terdeteksi satu turn demi satu turn." },
    sourcePaths: ["src/extensions/undo.ts", "README.md"],
    sourceLinks: [
      links("Undo source", "src/extensions/undo.ts"),
      links("README mention", "README.md"),
    ],
    guideRoute: "capabilities/continuity/undo",
    piComparison: "ergonomic",
  },
  {
    slug: "copy-turn",
    category: "continuity-and-recovery",
    en: { displayName: "Copy turn", benefit: "Copy a user or assistant result from the session by hash using `/cp <hash>`." },
    id: { displayName: "Salin turn", benefit: "Salin hasil user atau assistant dari sesi menggunakan hash dengan `/cp <hash>`." },
    sourcePaths: ["src/extensions/copy-turn.ts", "README.md"],
    sourceLinks: [
      links("Copy turn source", "src/extensions/copy-turn.ts"),
      links("README mention", "README.md"),
    ],
    guideRoute: "capabilities/continuity/copy-turn",
    piComparison: "ergonomic",
  },
  {
    slug: "context-compaction-reminder",
    category: "continuity-and-recovery",
    en: { displayName: "Context reminder", benefit: "Warn when a conversation grows large and suggest `/handoff-new` to reduce context and cost." },
    id: { displayName: "Pengingat konteks", benefit: "Peringatkan saat percakapan membesar dan sarankan `/handoff-new` untuk mengurangi konteks dan biaya." },
    sourcePaths: ["src/extensions/context-compaction-reminder.ts", "README.md"],
    sourceLinks: [
      links("Reminder source", "src/extensions/context-compaction-reminder.ts"),
      links("README mention", "README.md"),
    ],
    guideRoute: "capabilities/continuity/context-reminder",
    piComparison: "ergonomic",
  },
  {
    slug: "handoff-new",
    category: "continuity-and-recovery",
    en: { displayName: "Session handoff", benefit: "Create an editable continuation prompt in a clean session to reset context and cut token spend." },
    id: { displayName: "Handoff sesi", benefit: "Buat prompt kelanjutan yang dapat diedit dalam sesi bersih untuk mereset konteks dan menghemat token." },
    sourcePaths: ["src/extensions/handoff-new.ts", "README.md", "src/skills/handoff/", "src/skills/selesai-handoff/"],
    sourceLinks: [
      links("Handoff source", "src/extensions/handoff-new.ts"),
      links("Handoff skill", "src/skills/handoff/"),
      links("README mention", "README.md"),
    ],
    guideRoute: "capabilities/continuity/handoff-new",
    piComparison: "core-differentiator",
  },
  {
    slug: "pi-rewind-hook",
    category: "continuity-and-recovery",
    en: { displayName: "Rewind checkpoints", benefit: "Exact git-backed file checkpoints across `/fork`, `/tree`, resumed sessions, and session lineage." },
    id: { displayName: "Checkpoint rewind", benefit: "Checkpoint file yang didukung git secara tepat di `/fork`, `/tree`, sesi yang dilanjutkan, dan silsilah sesi." },
    sourcePaths: ["src/extensions/pi-rewind-hook/", "README.md"],
    sourceLinks: [
      links("Rewind source", "src/extensions/pi-rewind-hook/"),
      links("README mention", "README.md"),
    ],
    guideRoute: "capabilities/continuity/rewind",
    piComparison: "ergonomic",
  },
  {
    slug: "pi-powerline-footer",
    category: "terminal-workspace",
    en: { displayName: "Powerline footer", benefit: "Status bar, fixed-editor layout, recurring guide tour, persistent bash, stashes, themes, and Nerd Font detection." },
    id: { displayName: "Footer powerline", benefit: "Status bar, tata letak editor tetap, tur panduan berulang, bash persisten, stash, tema, dan deteksi Nerd Font." },
    sourcePaths: ["src/extensions/pi-powerline-footer/", "README.md", "src/core/footer-data-provider.ts"],
    sourceLinks: [
      links("Footer source", "src/extensions/pi-powerline-footer/"),
      links("README mention", "README.md"),
    ],
    guideRoute: "capabilities/workspace/powerline-footer",
    piComparison: "bundled",
  },
  {
    slug: "web-agent-onboarding",
    category: "terminal-workspace",
    en: { displayName: "Web agent onboarding", benefit: "First-run Brave Search onboarding for the web agent, with DuckDuckGo fallback." },
    id: { displayName: "Onboarding web agent", benefit: "Onboarding Brave Search pertama kali untuk web agent, dengan fallback DuckDuckGo." },
    sourcePaths: ["src/extensions/web-agent-onboarding.ts", "src/extensions/pi-web-agent/", "README.md"],
    sourceLinks: [
      links("Onboarding source", "src/extensions/web-agent-onboarding.ts"),
      links("Web agent source", "src/extensions/pi-web-agent/"),
      links("README mention", "README.md"),
    ],
    guideRoute: "capabilities/workspace/web-agent-onboarding",
    piComparison: "bundled",
  },
  {
    slug: "tokenin-onboarding",
    category: "terminal-workspace",
    en: { displayName: "Token onboarding", benefit: "First-run onboarding path for provider credentials and API tokens." },
    id: { displayName: "Onboarding token", benefit: "Jalur onboarding pertama kali untuk kredensial provider dan token API." },
    sourcePaths: ["src/extensions/tokenin-onboarding.ts", "README.md"],
    sourceLinks: [
      links("Token onboarding source", "src/extensions/tokenin-onboarding.ts"),
      links("README mention", "README.md"),
    ],
    guideRoute: "capabilities/workspace/tokenin-onboarding",
    piComparison: "bundled",
  },
  {
    slug: "inline-skills",
    category: "skills-and-productivity",
    en: { displayName: "Inline skills", benefit: "Lightweight inline skill invitations without separate skill files." },
    id: { displayName: "Skill inline", benefit: "Ajakan skill inline ringan tanpa file skill terpisah." },
    sourcePaths: ["src/extensions/inline-skills.ts", "README.md", "src/core/skills.ts"],
    sourceLinks: [
      links("Inline skills source", "src/extensions/inline-skills.ts"),
      links("Skills loader", "src/core/skills.ts"),
      links("README mention", "README.md"),
    ],
    guideRoute: "capabilities/skills/inline-skills",
    piComparison: "ergonomic",
  },
  {
    slug: "ponytail",
    category: "skills-and-productivity",
    en: { displayName: "Ponytail communication", benefit: "Minimal, compressed communication mode and review helpers invoked via `/skill:ponytail*`." },
    id: { displayName: "Komunikasi Ponytail", benefit: "Mode komunikasi minimal dan terkompresi serta helper review, dipanggil via `/skill:ponytail*`." },
    sourcePaths: ["src/extensions/ponytail/", "src/skills/ponytail*/", "README.md"],
    sourceLinks: [
      links("Ponytail extension", "src/extensions/ponytail/"),
      links("Ponytail skills", "src/skills/ponytail/"),
      links("README mention", "README.md"),
    ],
    guideRoute: "capabilities/skills/ponytail",
    piComparison: "bundled",
  },
  {
    slug: "caveman",
    category: "skills-and-productivity",
    en: { displayName: "Caveman communication", benefit: "Abbreviated, focused response style invoked via `/skill:caveman`." },
    id: { displayName: "Komunikasi Caveman", benefit: "Gaya responsi yang dipersingkat dan fokus, dipanggil via `/skill:caveman`." },
    sourcePaths: ["src/extensions/caveman/", "src/skills/caveman/", "README.md"],
    sourceLinks: [
      links("Caveman extension", "src/extensions/caveman/"),
      links("Caveman skill", "src/skills/caveman/"),
      links("README mention", "README.md"),
    ],
    guideRoute: "capabilities/skills/caveman",
    piComparison: "bundled",
  },
  {
    slug: "rtk",
    category: "skills-and-productivity",
    en: { displayName: "RTK integration", benefit: "Rewrite compatible shell commands to reduce noisy output and token burn when `rtk` is installed." },
    id: { displayName: "Integrasi RTK", benefit: "Tulis ulang shell command yang kompatibel untuk mengurangi output berisik dan penggunaan token saat `rtk` terpasang." },
    sourcePaths: ["src/extensions/rtk.ts", "README.md"],
    sourceLinks: [
      links("RTK source", "src/extensions/rtk.ts"),
      links("README mention", "README.md"),
    ],
    guideRoute: "capabilities/skills/rtk",
    piComparison: "ergonomic",
  },
];

export function capabilitiesByCategory(cat: Category) {
  return capabilities.filter((c) => c.category === cat);
}

export function getCapability(slug: string) {
  return capabilities.find((c) => c.slug === slug);
}

export function categoryLabel(cat: Category, locale: "en" | "id") {
  const category = categories.find((c) => c.id === cat);
  return locale === "en" ? category?.en ?? cat : category?.indonesian ?? cat;
}

export const EN_LABELS = {
  install: "Install",
  getStarted: "Get started",
  whySelesai: "Why Selesai",
  capabilities: "Capabilities",
  evidence: "Evidence",
  changelog: "Changelog",
  accessibility: "Accessibility & privacy",
};

export const ID_LABELS = {
  install: "Instal",
  getStarted: "Mulai",
  whySelesai: "Mengapa Selesai",
  capabilities: "Kemampuan",
  evidence: "Bukti dan metodologi",
  changelog: "Changelog",
  accessibility: "Aksesibilitas & privasi",
};
