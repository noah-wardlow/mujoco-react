/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ContactListener — component form of contact events (spec 2.5)
 */

import { useContactEvents } from '../hooks/useContacts';
import type { ContactListenerProps } from '../types';

/**
 * Component form of useContactEvents.
 * Fires onContactEnter/onContactExit callbacks when contacts change.
 */
export function ContactListener({
  body,
  onContactEnter,
  onContactExit,
}: ContactListenerProps) {
  useContactEvents(body, {
    onEnter: onContactEnter,
    onExit: onContactExit,
  });

  return null;
}
