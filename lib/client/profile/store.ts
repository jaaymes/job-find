import "client-only";

import { createStore } from "@/lib/client/storage/store";
import { migrateProfileV1toV2, Profile } from "@/lib/shared/schemas/profile";

/** Único store da chave do perfil (uma chave, um store). `null` = ainda sem perfil. */
export const profileStore = createStore("jobfind:v1:profile", Profile.nullable(), {
  version: 2,
  migrations: { 1: migrateProfileV1toV2 },
  initial: null,
});
