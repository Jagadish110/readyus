const KNOWN: Record<string, string> = {
  AUTH_REQUIRED: 'Please sign in to continue.',
  ADDRESS_NOT_FOUND: 'That address could not be found. Pick another one.',
  SELLER_NOT_FOUND: 'This shop is no longer available.',
  SELLER_UNAVAILABLE: 'This shop is not taking orders right now.',
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
