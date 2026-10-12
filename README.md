# J.A.R.V.I.S. — module finances

PWA perso. Toutes les données restent sur l'iPhone (localStorage), aucun serveur.

## Mettre en ligne (GitHub Pages, gratuit)
1. Crée un repo GitHub (ex. `jarvis`) et pousse ce dossier dedans.
2. Repo → Settings → Pages → Source : branche `main`, dossier `/ (root)`.
3. L'app est dispo sur `https://<ton-pseudo>.github.io/jarvis/`.

## Installer sur l'iPhone
Ouvre l'URL dans **Safari** → bouton Partager → **Sur l'écran d'accueil**.

## Mettre à jour
Modifie les fichiers, pousse sur GitHub, et change `CACHE = 'jarvis-vX'` dans `sw.js`.
Tes données ne sont pas touchées tant que l'URL ne change pas.

## Tester sur le Mac
`python3 -m http.server 8000` dans ce dossier, puis http://localhost:8000
