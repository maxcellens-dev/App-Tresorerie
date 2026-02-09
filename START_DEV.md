# 🚀 Comment lancer la dev facilement

## ⚡ Commande unique

```bash
npm run dev
```

C'est tout ! La dev server se lancera sur le port **8081, 8082 ou 8083** (selon ce qui est libre).

## 📱 Pour tester sur mobile/emulator

```bash
# Android emulator
npm run android

# iOS simulator  
npm run ios

# Web browser
npm run dev
```

## ⚙️ Pourquoi tellement de commandes avant ?

Les problèmes qu'on avait :
1. **Versions incompatibles** de `react-native` et `react-native-svg` → ✅ **Corrigé**
2. **Expo pas dans le PATH** → Maintenant tous les scripts utilisent `npx` → ✅ **Corrigé**
3. **Port 8081 déjà utilisé** → Expo auto-switch sur le prochain port dispo → ✅ **Normal**
4. **Pas de sortie visible** dans les logs → ✅ **Résolu avec `npm run dev`**

## 🔧 Si tu veux réinstaller les packages corrects

```bash
npm run fix-packages
```

## 📋 Status actuel

✅ Packages à jour
✅ Scripts npm simplifiés  
✅ Dev server lancé automatiquement
✅ Prêt pour dev en web/mobile/admin
