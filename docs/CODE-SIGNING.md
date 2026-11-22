# Code signing and the SmartScreen warning

## Why Windows says "Unknown publisher"

Microsoft Defender SmartScreen warns about any downloaded program that isn't signed with a code-signing
certificate, or whose signature hasn't built up reputation yet. The installer works the same either way; the
warning is about who made it, which Windows can't confirm without a signature.

There is no free way to sign that SmartScreen trusts: a self-signed certificate is treated as unsigned. Removing
the warning takes one of the options below, and each one needs an account or a purchase in the publisher's name.

## Options

| Option | Cost | What it takes | Removes the warning |
| --- | --- | --- | --- |
| **Azure Artifact Signing** (formerly Trusted Signing) | About $10 a month | An Azure subscription and identity validation of the person or organisation publishing. Eligibility depends on the country of the person or organisation; check Microsoft's current list. | Yes. The publisher name shows, and reputation builds up quickly |
| **OV code-signing certificate** from a certificate authority | Roughly $200–400 a year | Identity validation; the key lives on a hardware token or a cloud HSM | Yes, once the certificate has built some download reputation |
| **Microsoft Store** | Free for individual developers | A Partner Center account, then an MSIX build submitted for review | Yes. Microsoft signs Store packages |
| **winget** | Free | A manifest pull request to `microsoft/winget-pkgs` | Mostly. `winget install` doesn't go through the browser download check |

Azure Artifact Signing is the cheapest route for direct downloads, and the release workflow is already wired for it.

## Turning on Azure Artifact Signing

1. Create an Artifact Signing account in Azure, complete identity validation, and create a **public trust**
   certificate profile.
2. Create an app registration (service principal) and give it the **Artifact Signing Certificate Profile Signer**
   role on the signing account.
3. In the GitHub repository, go to **Settings → Secrets and variables → Actions** and add:

   | Kind | Name | Value |
   | --- | --- | --- |
   | Secret | `AZURE_TENANT_ID` | Directory (tenant) ID of the app registration |
   | Secret | `AZURE_CLIENT_ID` | Application (client) ID |
   | Secret | `AZURE_CLIENT_SECRET` | A client secret for the app registration |
   | Variable | `AZURE_SIGNING_ENDPOINT` | The account's endpoint, e.g. `https://eus.codesigning.azure.net` |
   | Variable | `AZURE_SIGNING_ACCOUNT` | The signing account name |
   | Variable | `AZURE_SIGNING_PROFILE` | The certificate profile name |
   | Variable | `AZURE_SIGNING_PUBLISHER` | The publisher name exactly as on the certificate (its CN) |

4. Push the next release tag. The [Release workflow](../.github/workflows/release.yml) signs the installer and
   the app when these are present, and builds unsigned (with a warning in the log) when they aren't.

The updater checks that new versions are signed by the same publisher as the installed one, so after the first
signed release every later release must be signed with the same publisher name.

## Until then

Users can run the installer with **More info → Run anyway**. Each release's installer is published with its
SHA-512 checksum in `latest.yml` on the release page.
