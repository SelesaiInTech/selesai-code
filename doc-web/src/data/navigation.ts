import { capabilities, categories } from "./capabilities.ts";

type SidebarConfig = Array<{
  label: string;
  link?: string;
  collapsed?: boolean;
  items?: SidebarConfig;
}>;

const en = categories.map((cat) => {
  const items = capabilities
    .filter((c) => c.category === cat.id)
    .map((c) => ({ label: c.en.displayName, link: `/${c.guideRoute}/` }));
  return {
    label: cat.en,
    collapsed: true,
    items,
  };
});

const id = categories.map((cat) => {
  const items = capabilities
    .filter((c) => c.category === cat.id)
    .map((c) => ({ label: c.id.displayName, link: `/id/${c.guideRoute}/` }));
  return {
    label: cat.indonesian,
    collapsed: true,
    items,
  };
});

export const navigation: SidebarConfig = [
  {
    label: "Home",
    link: "/",
  },
  {
    label: "Get started",
    link: "/get-started/",
  },
  {
    label: "Why Selesai",
    link: "/why-selesai/",
  },
  {
    label: "Capabilities",
    link: "/capabilities/",
  },
  {
    label: "Evidence",
    link: "/evidence/",
  },
  {
    label: "Changelog",
    link: "/changelog/",
  },
  {
    label: "Accessibility",
    link: "/accessibility/",
  },
  {
    label: "Guides",
    collapsed: true,
    items: en,
  },
  {
    label: "Beranda",
    link: "/id/",
  },
  {
    label: "Mulai",
    link: "/id/get-started/",
  },
  {
    label: "Mengapa Selesai",
    link: "/id/why-selesai/",
  },
  {
    label: "Kemampuan",
    link: "/id/capabilities/",
  },
  {
    label: "Bukti dan metodologi",
    link: "/id/evidence/",
  },
  {
    label: "Changelog",
    link: "/id/changelog/",
  },
  {
    label: "Aksesibilitas",
    link: "/id/accessibility/",
  },
  {
    label: "Panduan",
    collapsed: true,
    items: id,
  },
];
