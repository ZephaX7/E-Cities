# Configuration du Chatbot IA

## Variables d'environnement requises

Pour que le chatbot utilise l'IA au lieu du message fallback, configurez ces variables sur Render:

### Variables obligatoires:
```
AI_API_KEY=sk-xxxxxxxxxxxxx
AI_API_URL=https://api.openai.com/v1/chat/completions
AI_MODEL=gpt-4o-mini
```

### Comment configurer sur Render:
1. Dashboard Render → votre Web Service
2. Onglet "Environment"
3. Ajoutez les 3 variables ci-dessus
4. Cliquez "Save Changes" (redémarrage automatique)

### OpenAI API Key:
- Créez un compte sur https://platform.openai.com/
- Allez dans "API keys"
- Créez une nouvelle clé secrète
- Copiez-la dans `AI_API_KEY`

## Fonctionnement

### Sans API Key:
- Le chatbot répond: "Je suis actuellement indisponible..."
- Les tickets sont quand même créés si l'utilisateur décrit un problème

### Avec API Key:
- Le chatbot répond intelligemment aux questions
- Les conversations incluent la réponse IA dans le ticket
- L'historique est sauvegardé localement dans le navigateur

## Détection des problèmes

Le système crée automatiquement un ticket (visible dans l'admin) si le message contient:
- problème
- erreur
- bug
- panne
- ne marche pas
- ne fonctionne pas
- impossible
- bloqué
- aide

## Tickets créés par le chatbot

Dans l'admin, les tickets chatbot sont identifiables par:
- Titre commençant par 🤖
- Format: `🤖 Chatbot: [début du message]`
- Contenu formaté avec la demande + réponse IA

## Persistance de l'historique

L'historique des conversations est sauvegardé dans localStorage:
- Clé: `ecities_chat_history`
- Survit aux rechargements de page
- Supprimé si l'utilisateur vide son cache navigateur
