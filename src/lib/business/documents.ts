import { serverApi } from '@/lib/api/server';

export type DocumentKind = 'fssai' | 'gst';
export type DocumentStatus = 'pending' | 'approved' | 'rejected';

export type ShopDocument = {
  kind: DocumentKind;
  number: string;
  valid_until: string | null;
  status: DocumentStatus;
  review_note: string;
  updated_at: string;
};

export type DocumentsInfo = { documents: ShopDocument[]; fssaiRequired: boolean; dueAt: string | null };

export async function loadDocuments(): Promise<DocumentsInfo | null> {
  const result = await serverApi<DocumentsInfo>('/v1/seller/documents');
  return result.ok ? result.data : null;
}

/** What the owner has to do about the FSSAI licence, or null when nothing is needed. */
export function fssaiAttention(info: DocumentsInfo, now = Date.now()): { tone: 'warn' | 'danger'; message: string } | null {
  if (!info.fssaiRequired) return null;
  const fssai = info.documents.find((doc) => doc.kind === 'fssai');
  const days = fssai?.valid_until ? Math.ceil((new Date(fssai.valid_until).getTime() - now) / 86_400_000) : null;

  if (fssai?.status === 'rejected') return { tone: 'danger', message: 'Your FSSAI document was not accepted. Upload a correct one.' };
  if (fssai?.status === 'approved' && days !== null && days < 0) {
    return { tone: 'danger', message: 'Your FSSAI licence has expired, so your shop is hidden. Upload the renewed licence.' };
  }
  if (fssai?.status === 'approved' && days !== null && days <= 30) {
    return { tone: 'warn', message: `Your FSSAI licence expires in ${Math.max(days, 0)} days. Upload the renewal to stay visible.` };
  }
  if (!fssai) {
    const left = info.dueAt ? Math.ceil((new Date(info.dueAt).getTime() - now) / 86_400_000) : null;
    // A deadline far away is not worth a banner on every page.
    if (left !== null && left > 45) return null;
    if (left !== null && left <= 0) return { tone: 'danger', message: 'Your shop is hidden: add your FSSAI licence to come back.' };
    return { tone: 'warn', message: left !== null ? `Add your FSSAI licence within ${left} days to stay visible.` : 'Add your FSSAI licence so your shop can be approved.' };
  }
  return null;
}
