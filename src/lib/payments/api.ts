
export type PayoutStatus = 'created' | 'under_review' | 'needs_clarification' | 'activated' | 'rejected';

export type PayoutAccount = {
  status: PayoutStatus;
  status_detail: string;
  beneficiary_name: string | null;
  bank_ifsc: string | null;
  bank_last4: string | null;
  /** New shops are paid to a UPI ID; shops set up before 0041 may still be on a bank account. */
  payout_method?: 'bank' | 'upi';
  /** The UPI ID, masked, like "pi•••@okhdfcbank". */
  upi_display?: string | null;
};
