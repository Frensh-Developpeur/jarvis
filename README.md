# J.A.R.V.I.S.

Assistant personnel en PWA : https://frensh-developpeur.github.io/jarvis/

- **App** (GitHub Pages) : `index.html`, `core/` (socle : comptes, synchro, hub), `modules/` (une fonction = un module)
- **API** (Cloudflare Worker + D1) : `server/` — https://jarvis-api.frensh-developpeur.workers.dev

## Comptes
Connexion par identifiant + code d'authenticator (TOTP). Le premier compte créé est administrateur ;
les suivants s'inscrivent avec un code d'invitation créé dans Réglages → Administration.
Authenticator perdu : l'admin crée une invitation « RÉINIT. » pour ce compte.
Admin qui perd son authenticator : `cd server && npx wrangler d1 execute jarvis-db --remote --command "INSERT INTO invites (code, created_by, reset_user, created_at, expires_at) VALUES ('SECOURS1', 'cli', '<identifiant>', unixepoch(), unixepoch()+86400)"`
puis « J'ai un code d'invitation » avec le code `SECOURS1`.

## Installer sur l'iPhone
Safari → Partager → **Sur l'écran d'accueil**.

## Publier une mise à jour
- App : `./bump.sh && git commit -am "..." && git push` (l'app se met à jour seule à l'ouverture)
- API : `cd server && npx wrangler deploy`

## Développer en local
`npx wrangler dev --local` dans `server/` + `python3 -m http.server 8000` à la racine,
puis http://localhost:8000 (l'app utilise automatiquement l'API locale).

## Ajouter un module
Voir [modules/README.md](modules/README.md).
