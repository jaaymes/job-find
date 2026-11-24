import "client-only";

import { createStore } from "@/lib/client/storage/store";
import { Profile } from "@/lib/shared/schemas/profile";

/** Único store da chave do perfil (uma chave, um store). `null` = ainda sem perfil. */
export const profileStore = createStore("jobfind:v1:profile", Profile.nullable(), { version: 1, initial: null });
