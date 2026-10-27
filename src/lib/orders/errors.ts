const KNOWN: Record<string, string> = {
  AUTH_REQUIRED: 'Please sign in to continue.',
  ADDRESS_NOT_FOUND: 'That address could not be found. Pick another one.',
  SELLER_NOT_FOUND: 'This shop is no longer available.',
  SELLER_UNAVAILABLE: 'This shop is not taking orders right now.',
  SELLER_NOT_ACCEPTING_ORDERS: 'This shop is not taking new orders right now.',
  SHOP_CLOSED: 'This shop is closed right now. Try again when it opens, or choose another shop.',
  SELLER_LOCATION_REQUIRED: 'This shop has not set its location yet.',
  OUTSIDE_DELIVERY_RADIUS: 'This shop does not deliver that far. Choose an address closer to it.',
  CART_EMPTY: 'Your cart for this shop is empty.',
  BELOW_MIN_ORDER: 'This order is below the shop minimum.',
  BELOW_MIN_QUANTITY: 'An item is below its minimum quantity.',
  PRODUCT_UNAVAILABLE: 'An item is no longer available.',
  INSUFFICIENT_STOCK: 'There is not enough stock left for an item.',
  ORDER_NOT_FOUND: 'We could not find that order.',
  ORDER_NOT_CANCELLABLE: 'The shop has already started on this order, so it can no longer be cancelled.',
  ORDER_NOT_DECIDABLE: 'This order has already been handled.',
  NO_CLAIM_TO_VERIFY: 'There is no payment waiting to be checked.',
  PAYMENT_NOT_PENDING: 'This order is not waiting for a payment.',
  INVALID_DELIVERY_CODE: 'That code is not right. Ask the customer to read it again.',
  CODE_LOCKED: 'Too many wrong codes. Wait 15 minutes, then ask the customer for the code again.',
  FSSAI_REQUIRED: 'This food shop has no approved, unexpired FSSAI licence yet. Review its document first.',
  DOCUMENT_NOT_FOUND: 'That document was not found.',
  DOCUMENT_EXPIRED: 'This licence has already expired. Upload the renewed one.',
  INVALID_FILE: 'That file could not be used. Upload it again.',
  ORDER_NOT_DELIVERABLE: 'This order is not out for delivery, so it cannot be marked as failed.',
  UNKNOWN_CAUSE: 'Choose what went wrong.',
  NOTHING_TO_REFUND: 'This order was not paid online, so there is nothing to refund here.',
  REFUND_TOO_LARGE: 'That is more than was paid online and not yet refunded.',
  INVALID_AMOUNT: 'Enter an amount greater than zero.',
  ORDER_NOT_STARTED: 'You can report a problem once the shop has accepted the order.',
  TOO_MANY_ISSUES: 'You already have three open problems on this order. Wait for the shop to reply.',
  ISSUE_NOT_FOUND: 'That problem could not be found.',
  RIDER_NOT_IN_TEAM: 'That rider is not on your delivery team. Add them with a rider code first.',
  ORDER_ALREADY_PICKED_UP: 'The rider has already picked this order up, so it cannot be reassigned.',
  SELLER_PROFILE_REQUIRED: 'Only the shop can do that.',
  ASSIGNMENT_NOT_FOUND: 'This delivery is no longer assigned to you.',
  ORDER_NOT_READY: 'This order is not ready for pickup yet.',
  NOT_IN_SELLER_FLEET: 'You are not part of this shop’s delivery team.',
  DELIVERY_PROFILE_REQUIRED: 'Set up your delivery profile first.',
  ONLINE_PAYMENT_NOT_VERIFIED: 'The online payment for this order has not been confirmed yet.',
  INVITE_NOT_FOUND: 'That code does not exist. Check it and try again.',
  INVITE_ALREADY_USED: 'That code has already been used.',
  INVITE_EXPIRED: 'That code has expired. Ask the shop for a new one.',
  ORDER_NOT_DELIVERED: 'You can rate an order once it is delivered.',
  INVALID_RATING: 'Ratings go from 1 to 5 stars.'
};

/** Turns a Postgres exception from one of our functions into a sentence. */
export function friendlyError(message: string | undefined | null) {
  if (!message) return 'Something went wrong. Please try again.';
  const code = Object.keys(KNOWN).find((key) => message.includes(key));
  if (!code) return 'Something went wrong. Please try again.';
  const detail = message.split(`${code}:`)[1]?.trim();
  return detail ? `${KNOWN[code]} (${detail})` : KNOWN[code]!;
}
