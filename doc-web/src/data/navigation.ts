import { capabilities, categories } from "./capabilities.ts";

type SidebarConfig = Array<{
  label: string;
  translations?: Record<string, string>;
  link?: string;
  collapsed?: boolean;
  items?: SidebarConfig;
}>;

const guides = categories.map((category) => ({
  label: category.en,
  translations: { id: category.indonesian },
  collapsed: true,
  items: capabilities
    .filter((capability) => capability.category === category.id)
    .map((capability) => ({
      label: capability.en.displayName,
      translations: { id: capability.id.displayName },
      link: `/${capability.guideRoute}/`,
    })),
}));

export const navigation: SidebarConfig = [
  { label: "Overview", translations: { id: "Ringkasan" }, link: "/" },
  { label: "Get started", translations: { id: "Mulai" }, link: "/get-started/" },
  { label: "Why Selesai", translations: { id: "Mengapa Selesai" }, link: "/why-selesai/" },
  { label: "Capabilities", translations: { id: "Kemampuan" }, link: "/capabilities/" },
  {
    label: "Guides",
    translations: { id: "Panduan" },
    collapsed: false,
    items: guides,
  },
  { label: "Evidence", translations: { id: "Bukti" }, link: "/evidence/" },
  { label: "Changelog", link: "/changelog/" },
  { label: "Accessibility", translations: { id: "Aksesibilitas" }, link: "/accessibility/" },
];
