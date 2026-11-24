"use client";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ProviderDef } from "@/lib/client/ai/providers";

type Props = {
  /** Provedor com `privacyNote`; `null` fecha o diálogo. */
  provider: ProviderDef | null;
  onConfirm: () => void;
  onCancel: () => void;
};

/** Aviso de privacidade que o usuário precisa aceitar antes de usar o provedor. */
export function PrivacyConsentDialog({ provider, onConfirm, onCancel }: Props) {
  return (
    <Dialog open={provider !== null} onOpenChange={(open) => !open && onCancel()}>
      <DialogContent>
        {provider && (
          <>
            <DialogHeader>
              <DialogTitle>Aviso de privacidade — {provider.label}</DialogTitle>
              <DialogDescription>{provider.privacyNote}</DialogDescription>
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
