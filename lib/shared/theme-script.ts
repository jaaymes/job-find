// Sem "client-only": este módulo é lido no servidor pelo csp.ts (next.config.ts e proxy.ts).
// Mantenha-o sem dependências.

/** Chave do localStorage com a preferência de tema. */
export const THEME_STORAGE_KEY = "jf-theme";

export type ThemePref = "light" | "dark" | "system";

/**
 * Script inline que roda no <head> antes da pintura: lê a preferência salva, resolve
 * "system" pelo prefers-color-scheme e aplica a classe `dark` e o `color-scheme` no <html>,
 * evitando o flash de tema errado. localStorage e matchMedia podem lançar (modo privado,
 * navegador antigo), por isso cada acesso fica em try/catch.
 *
 * ATENÇÃO: qualquer mudança neste texto (inclusive espaços) muda o hash abaixo. Gere o novo com
 *   node -e 'const {createHash}=require("node:crypto");console.log(createHash("sha256").update(SCRIPT,"utf8").digest("base64"))'
 * O teste tests/unit/shared/theme-script.test.ts confere que os dois batem.
 */
export const THEME_SCRIPT = `(function(){try{var d=document.documentElement,p=null,k=false;try{p=localStorage.getItem(${JSON.stringify(THEME_STORAGE_KEY)})}catch(e){}if(p==="dark"){k=true}else if(p!=="light"){try{k=window.matchMedia("(prefers-color-scheme: dark)").matches}catch(e){}}d.classList.toggle("dark",k);d.style.colorScheme=k?"dark":"light"}catch(e){}})()`;

/** sha256 de THEME_SCRIPT, liberado no script-src da CSP com nonce (rotas `(local)`). */
export const THEME_SCRIPT_HASH = "'sha256-4GwBZV81cWXwQc3I95dn7VRgmTw79fsD+LNa1+Ev5g0='";
