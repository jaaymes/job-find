"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ProviderDef } from "@/lib/client/ai/providers";
import type { DialogFinalFocus } from "./AddKeyDialog";

type Props = {
  /** Provedor com `privacyNote`; `null` fecha o diálogo. */
  provider: ProviderDef | null;
  /** Título e texto próprios (ex.: aviso dos modelos gratuitos); sem eles, usa o `privacyNote` do provedor. */
  title?: string;
  note?: string;
  onConfirm: () => void;
  onCancel: () => void;
  /** Para onde vai o foco ao fechar (repassado ao `DialogContent`); sem ele, volta ao elemento que abriu o diálogo. */
  finalFocus?: DialogFinalFocus;
};

/** Aviso de privacidade que o usuário precisa aceitar antes de usar o provedor. */
export function PrivacyConsentDialog({ provider, title, note, onConfirm, onCancel, finalFocus }: Props) {
  return (
    <Dialog open={provider !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent finalFocus={finalFocus}>
        {provider && (
          <>
            <DialogHeader>
              <DialogTitle>{title ?? `Aviso de privacidade — ${provider.label}`}</DialogTitle>
              <DialogDescription>{note ?? provider.privacyNote}</DialogDescription>
            </DialogHeader>
            <DialogFooter>
              <Button variant="outline" className="min-h-11" onClick={onCancel}>
                Cancelar
              </Button>
              <Button className="min-h-11" onClick={onConfirm}>Entendi e aceito</Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
