// O Next embute o path-to-regexp sem tipos; só o que o teste do matcher usa.
declare module "next/dist/compiled/path-to-regexp" {
  export function pathToRegexp(path: string): RegExp;
}
