
export type PayoutStatus = 'created' | 'under_review' | 'needs_clarification' | 'activated' | 'rejected';

export type PayoutAccount = {
  status: PayoutStatus;
  status_detail: string;
  beneficiary_name: string | null;
  bank_ifsc: string | null;
  bank_last4: string | null;
};
