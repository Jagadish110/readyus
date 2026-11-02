
export type PayoutStatus = 'created' | 'under_review' | 'needs_clarification' | 'activated' | 'rejected';

export type PayoutAccount = {
  status: PayoutStatus;
  status_detail: string;
  beneficiary_name: string | null;
  bank_ifsc: string | null;
  bank_last4: string | null;
  /** Paid to a bank account or a UPI ID. Missing on accounts saved before 0041: those are bank. */
  payout_method?: 'bank' | 'upi';
  /** The UPI ID, masked, like "pi•••@okhdfcbank". */
  upi_display?: string | null;
};
