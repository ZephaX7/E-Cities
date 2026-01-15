# Migration Frontend vers Vercel ✅

## ✨ Fichiers créés pour Vercel:

### 1. **vercel.json** - Configuration Vercel
- Configure le déploiement statique sur Vercel
- Route les URL vers `templates/dossier1/index.html` (SPA)
- Cache les assets pour optimiser les performances

### 2. **package.json** - Manifest du frontend
- Décrit le frontend comme un projet Node.js
- Nécessaire pour Vercel

### 3. **.vercelignore** - Fichiers à ignorer
- Exclude le Go, le backend et autres fichiers inutiles

### 4. **.env.example** - Variables d'environnement
- Template pour les variables d'env

---

## 🚀 Étapes pour déployer sur Vercel:

### Étape 1: Connecter le repo à Vercel
```bash
# Si tu n'as pas l'CLI Vercel:
npm install -g vercel

# Se connecter et déployer
vercel
```

### Étape 2: Configurer les variables d'environnement
Dans le dashboard Vercel ou via CLI, ajoute:
```
VITE_API_URL=https://your-backend-on-render.com
```

### Étape 3: Mettre à jour l'URL du backend dans les HTML
Dans les templates, ajoute cette balise meta avec l'URL de ton backend Render:

```html
<meta name="api-base" content="https://your-backend-on-render.com">
```

À ajouter dans le `<head>` de:
- `templates/dossier1/index.html`
- `templates/dossier1/map.html`
- `templates/dossier1/profile.html`
- `templates/dossier1/projects.html`
- `templates/dossier1/visualization.html`

---

## 🔧 Configuration du Backend (Render)

### Créé: **backend/render.yaml**
Configuration pour Render qui inclut:
- Variables d'environnement nécessaires
- `ALLOWED_ORIGIN` doit pointer vers ton URL Vercel

À mettre à jour dans Render:
```
ALLOWED_ORIGIN=https://your-frontend-on-vercel.com
DATABASE_URL=ta_database_url
```

---

## 📝 Résumé des URLs à remplacer:

| Où | Remplacer | Par |
|---|---|---|
| HTML templates | `meta[name="api-base"]` | `https://your-backend-render.com` |
| Render Dashboard | `ALLOWED_ORIGIN` | `https://your-frontend-vercel.com` |
| Vercel Dashboard | `VITE_API_URL` | `https://your-backend-render.com` |

---

## ⚠️ Important:
- Le **frontend** tourne sur **Vercel** (assets statiques)
- Le **backend** tourne sur **Render** (API Express)
- Les scripts JS lisent l'API depuis la meta tag `api-base`
- CORS est configuré avec `ALLOWED_ORIGIN`

---

## ✅ Prochaines étapes:
1. Détermine tes URLs réelles (une fois déployées)
2. Mets à jour les balises meta dans les templates
3. Mets à jour les variables d'env dans Render et Vercel
4. Teste les appels API cross-domain
