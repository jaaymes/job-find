import type { Metadata } from "next";
import { AiSettingsScreen } from "@/components/settings/AiSettingsScreen";

export const metadata: Metadata = { title: "Configurações de IA — Job Find" };

export default function ConfiguracoesPage() {
  return <AiSettingsScreen />;
}
