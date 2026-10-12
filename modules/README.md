# Créer un module Jarvis

Un module = un dossier `modules/<id>/` avec un `.js` (et un `.css` si besoin).

## 1. Le fichier JS

```js
(() => {
let st, root, fixed;

J.module({
  id: 'nutrition',              // identifiant unique (minuscules) — sert aussi de clé de stockage
  code: '02',                   // numéro affiché sur la tuile
  name: 'Nutrition',
  tagline: 'Compteur de calories',
  accent: '#4dffc3',            // couleur de l'icône sur le hub
  cls: 'nut',                   // classe CSS posée sur la vue (pour préfixer tes styles)
  icon: '<svg …>…</svg>',

  init() {                      // appelé à la connexion
    st = J.store('nutrition', {meals: []});   // document synchronisé avec le serveur
    st.onChange(() => root && render());      // données mises à jour depuis un autre appareil
  },
  summary() { return 'Aujourd\'hui <b>1 450 kcal</b>'; },   // texte de la tuile (HTML)
  brief()   { return 'Vous avez consommé 1 450 calories.'; }, // phrase dans le message du hub
  report()  { return '…'; },                                 // phrase du briefing vocal

  mount(body, fx) {             // ouverture du module
    root = body;                // contenu qui défile
    fixed = fx;                 // bouton +, feuilles (éléments position:fixed)
    root.innerHTML = '…';
    J.say('Module nutrition en ligne.');
  },
  unmount() { root = fixed = null; },
});
})();
```

Modifier les données : `st.data.meals.push(…); st.save();` — c'est enregistré sur le téléphone
et envoyé au serveur automatiquement.

## 2. L'enregistrer
Dans `index.html` : ajouter `<script src="modules/<id>/<id>.js">` (et le `<link>` CSS),
retirer la ligne `J.soon({id:'<id>', …})` correspondante.
Dans `sw.js` : ajouter les fichiers à `ASSETS`.

## Services disponibles (`J.…`)
`store(id, defaults)` · `say(texte)` · `speak(texte)` · `toast(texte)` · `openSheet(el)` / `closeSheet()`
· `reactorSVG(prefixe)` + `setArc(el, ratio)` · `greeting()` · `prefs()` · `go(id)` · `eur(n)` · `esc(s)` · `uid()`
