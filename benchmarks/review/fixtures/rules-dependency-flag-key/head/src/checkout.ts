import { isEnabled } from '@acme/flags'

export function checkoutSteps(): string[] {
  if (isEnabled('newCheckoutFlow')) return ['cart', 'review-and-pay']
  const steps = ['cart', 'shipping', 'payment']
  if (isEnabled('express-pay')) steps.splice(2, 0, 'express')
  return steps
}
