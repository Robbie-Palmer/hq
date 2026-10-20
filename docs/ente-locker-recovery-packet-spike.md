# Ente Locker recovery-packet spike

- Status: complete
- Work item: `homelab-spike-ente-locker`
- Evidence date: 20 October 2026

## Question

Can Ente Locker hold a small mobile copy of a digital recovery packet without
becoming the canonical store, and can another person retrieve that copy when
the owner's usual devices are unavailable?

## Packet boundary

The packet is a short set of recovery instructions and supporting records:

- an ordered recovery runbook for the password manager and primary email;
- hardware security-key locations and purpose, without copying private keys;
- domain registrar, renewal, insurance, identity, and emergency-contact notes;
- Ente, Proton, Doppler, and restic recovery instructions; and
- a plain-language first page for someone who does not operate the homelab.

Locker is only a replica. Each item must name a canonical source outside Ente
and a recovery method that does not require the Locker copy. The canonical
packet stays in an encrypted local directory covered by the Home Lab archive.
Minimum offline material includes the Ente recovery key and any secret needed
to unlock that archive.

The packet excludes the complete password vault, live TOTP seeds, private
hardware-key material, daily documents, the only copy of any recovery secret,
and anything without an independently recoverable source.

## Evidence

| Check | Result | Evidence |
| --- | --- | --- |
| Current limits | Confirmed | Ente documents 100 items and 1 GB on the free plan, or 1,000 items and 10 GB with any paid Ente subscription. Locker storage is separate from Photos storage. |
| Current cost | Confirmed | Locker has no separate charge. The existing paid Photos plan supplies the paid Locker limits. On the evidence date, Ente's lowest UK paid Photos plan was GBP 2.49 monthly or GBP 29.88 annually. |
| Bulk export | Failed by design | Locker has no data export. Ente says users can view and copy individual items manually while an export feature remains planned. Locker therefore cannot be canonical or hold the only copy of an item. |
| Clean-device retrieval | Passed hands-on | A new Pixel 7-sized browser session signed in to the synthetic account and displayed all three items. Each downloaded file matched its source SHA-256 digest. A new device still needs the Ente credentials, 2FA when enabled, and the recovery key for a fully logged-out password reset. |
| Account recovery | Confirmed from product documentation | A signed-in device can change the password. A fully logged-out user needs the 24-word recovery key, unless Legacy recovery was configured earlier. Ente support cannot reconstruct the key. The destructive recovery-key reset was not completed because the paused test browser discarded the throwaway credentials. |
| Collection sharing | Passed hands-on | The synthetic collection was shared with a second test Ente account. The recipient saw and downloaded all three items but had no edit or item-management controls. Removing the recipient made the collection disappear immediately. This did not revoke a separately created public link. |
| Public-link sharing | Partly hands-on, otherwise documented | A bearer link was created for the synthetic insurance item. The live UI warned that anyone with the URL could access it and that deleting the link revokes access. The signed-out page loaded successfully, but the paused test browser discarded the throwaway credentials before the final delete-and-reopen check. Ente documents deletion as the revocation mechanism. |
| Trusted-contact recovery | Confirmed from product documentation | A trusted contact is an Ente user who may reset the owner's account password after a 7, 14, or 30 day wait. This flow recovers the account. Shared collections provide packet access. The owner can remove the contact or block an active attempt. |
| Legacy Kit effects | Confirmed from product documentation | A kit creates three physical sheets. Any two reconstruct a separate kit secret in the browser and can start password-reset recovery after an immediate, 1, 7, 15, or 30 day wait. A completed recovery exposes the whole Ente account. It has no collection boundary. Blocking stops only the active attempt; deleting the kit also disables its sheets. Existing kits may stop working if the account recovery key changes. |
| Independent source for every item | Passed hands-on | The test collection contained exactly the three manifest items. Each began as a retained local source file, and every downloaded copy matched its recorded SHA-256 digest. No unmatched Locker item appeared in the synthetic account. |

## Synthetic drill

Use a clean browser or phone profile rather than the owner's existing session.
Do not upload a real identity document, credential, recovery key, or the only
copy of anything.

| Synthetic Locker item | Independent source | Proof |
| --- | --- | --- |
| `RECOVERY-START-HERE.txt` | A local source file retained outside Ente | Download matched source SHA-256 `6810b85bdf01fb86928973c550a2f216e99ad1cceaf301f14a378530f3d30726`. |
| `TEST-INSURANCE-CARD.txt` | A local source file containing invented names and policy numbers | Download matched source SHA-256 `de76027c3851b28ea914b4fd12ba61aa7444d42c19652673bb90ed00d7c2cb6a`. |
| `TEST-ACCOUNT-RECOVERY.txt` | A local source file containing invented recovery instructions | Download matched source SHA-256 `7db3c8fcfc47559c68cdbf9c4d07f84a3304e7f4915684bfb65418b8091ca21d`. |

The live drill used two throwaway Ente accounts and no personal data. It:

1. added the three items to `Recovery packet spike` and confirmed the account
   showed three of its 100 free-plan items;
2. signed in from a clean mobile-sized session, retrieved each item, and
   matched all three SHA-256 digests;
3. shared the collection with a second Ente user, confirmed read-only access,
   removed that user, and confirmed the collection disappeared immediately;
4. created a bearer link and inspected its signed-out loading path and explicit
   revocation warning; and
5. reconciled the complete Locker inventory with the three source files.

The drill did not generate a Legacy Kit. Its sheets are live whole-account
recovery secrets, and the documented behavior answers the architecture
question without creating material that then needs secure custody and
destruction. The browser session was paused after the public-link check and
lost its throwaway credentials, so the final old-URL check and destructive
recovery-key reset were not completed. No result below depends on treating
either check as hands-on evidence.

## Current recommendation

Accept the revised ADR 003. Ente Locker fits the narrow replica role, and the
architecture now keeps three mechanisms separate:

- collection sharing gives a known Ente user routine read-only packet access;
- public links give anyone holding a bearer URL access until that link is
  deleted; and
- trusted contacts and Legacy Kits can recover the whole Ente account after a
  waiting period.

The lack of export makes the independent-source manifest a permanent control.
A one-time migration check is insufficient. The live clean-session, direct
share, direct revocation, retrieval, and inventory checks passed. Public links
remain exceptional bearer capabilities whose deletion must be tested after
each use; they are not part of the standing packet. Account recovery and
Legacy remain whole-account controls governed by their recovery key, waiting
period, and custody procedures rather than by collection membership.

## Primary sources

- [Ente Locker introduction](https://ente.com/help/locker/)
- [Getting Started FAQ](https://ente.com/help/locker/faq/getting-started)
- [Security FAQ](https://ente.com/help/locker/faq/security)
- [Sharing collections with Ente users](https://ente.com/help/locker/features/sharing/share-with-users)
- [Sharing FAQ](https://ente.com/help/locker/faq/sharing)
- [Legacy](https://ente.com/help/locker/features/legacy/)
- [Legacy Kits](https://ente.com/help/locker/features/legacy/legacy-kits)
- [Ente pricing](https://ente.com/pricing)
