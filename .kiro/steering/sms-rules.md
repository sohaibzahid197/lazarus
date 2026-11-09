---
inclusion: fileMatch
fileMatchPattern: "packages/brain/**"
---
# SMS rules

- GSM-7 text: 160 chars single, 153 per part when split (UDH header).
- Any non GSM-7 character (Urdu, emoji, many symbols) switches the whole message to UCS-2: 70 chars single, 67 per part.
- Count GSM-7 extension chars (^ { } \ [ ~ ] | €) as 2.
- Never split inside a surrogate pair or a word when a space exists in the last 15 chars of the part.
- Joining all parts must give back the original text exactly (after part prefixes are removed).
- Prefix parts as "(1/3) " only when more than one part; prefix counts toward the limit.
- Hard cap: 4 parts per reply. Summarise rather than exceed it.
