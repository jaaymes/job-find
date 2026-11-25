/**
 * Oculta uma barra fixa enquanto um campo de entrada de texto tem foco (o teclado do celular já
 * ocupa a tela). Checkbox, radio, range, file, button, submit e select não contam: o foco neles
 * não abre teclado e deixaria a barra escondida até o foco sair.
 */
export const HIDE_ON_TEXT_FOCUS =
  "[body:has(input:focus:not([type=checkbox],[type=radio],[type=range],[type=file],[type=button],[type=submit]),textarea:focus)_&]:hidden";
