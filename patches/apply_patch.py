#!/usr/bin/env python3
"""Apply the CHLOE AI source updates to the repository root.

Run from the extracted package directory:
    python apply_patch.py /path/to/Chloe-final-version
The script is guarded: it stops if expected source anchors are missing.
"""
from pathlib import Path
import shutil
import sys

if len(sys.argv) != 2:
    raise SystemExit('Usage: python apply_patch.py /path/to/Chloe-final-version')
root = Path(sys.argv[1]).resolve()
if not (root / 'package.json').exists() or not (root / 'server/routes.ts').exists():
    raise SystemExit('Erreur: le dossier cible ne ressemble pas à la racine du dépôt CHLOÉ AI.')

package_root = Path(__file__).resolve().parent.parent
modified_files = {}

def replace_once(path: str, old: str, new: str, label: str):
    target = root / path
    content = modified_files.get(path)
    if content is None:
        content = target.read_text(encoding='utf-8')
    count = content.count(old)
    if count != 1:
        raise SystemExit(f'Arrêt sécurisé: ancre introuvable ou ambiguë pour {label} ({path}, occurrences={count}). Aucun fichier source n’a été écrit.')
    modified_files[path] = content.replace(old, new)
    print(f'Préparé: {label}')

# Stage replacement/new files. Nothing is written until every source anchor passes.
modified_files['server/providers.ts'] = (package_root / 'server/providers.ts').read_text(encoding='utf-8')
modified_files['src/lib/api-base.ts'] = (package_root / 'src/lib/api-base.ts').read_text(encoding='utf-8')
modified_files['.env.production.example'] = (package_root / '.env.production.example').read_text(encoding='utf-8')
print('Préparé: remplacement du gestionnaire fournisseur et ajout du helper API')

# Keep private runtime state and local signing/config files out of future commits.
gitignore = root / '.gitignore'
private_rules = [
    '',
    '# CHLOE AI private runtime data and machine-specific configuration',
    'data/*.json',
    'data/backups/*.json',
    'android/local.properties',
    '.env',
    '.env.*',
    '!.env.example',
    '!.env.production.example',
]
existing_ignore = gitignore.read_text(encoding='utf-8') if gitignore.exists() else ''
if existing_ignore and not existing_ignore.endswith('\n'):
    existing_ignore += '\n'
for rule in private_rules[1:]:
    if rule not in existing_ignore.splitlines():
        existing_ignore += rule + '\n'
modified_files['.gitignore'] = existing_ignore
print('Préparé: .gitignore renforcé')

# Expose the configured remote backend to all existing relative /api fetch calls.
replace_once(
    'src/App.tsx',
    "import React, { useState, useEffect, useCallback } from 'react';",
    "import './lib/api-base.ts';\nimport React, { useState, useEffect, useCallback } from 'react';",
    'API base URL globale',
)

# Reflect that a stored key is not necessarily a verified/live connection.
replace_once(
    'shared/types.ts',
    "status: 'connected' | 'not_configured' | 'error';",
    "status: 'connected' | 'configured_untested' | 'not_configured' | 'error';",
    'état fournisseur configuré/non testé',
)

# Provider manager: explicit provider selection, real fallback order and model endpoint.
old_external = """    if (activeProv !== 'gemini' && providerManager.getKey(activeProv)) {
      try {
        const systemInstruction = buildChloeSystemInstruction(settings, db.getMemories(userId), db.getSkills());
        const completion = await providerManager.generateChatCompletion({
          systemPrompt: systemInstruction,
          messages: [{ role: 'user', content: message || 'Analyse cette image' }],
          image,
        });

        if (completion.text) {
          db.recordUsage(250);
          const assistantMsg = db.addMessage(
            conversationId,
            {
              role: 'assistant',
              content: completion.text,
              agentInvolved: specializedAgent,
            },
            userId
          );
          db.log(userId, specializedAgent.toUpperCase(), `Réponse générée via ${provInfo.activeProvider} (${completion.modelUsed})`, 'LEVEL_1_CONSULTATION', 'success', `Tokens estimés : 250`);
          return res.json(assistantMsg);
        }
      } catch (err: any) {
        console.warn(`Fallback sur Gemini ou local suite à erreur ${activeProv}:`, err.message);
      }
    }
"""
new_external = """    if (activeProv !== 'gemini' && providerManager.getKey(activeProv)) {
      try {
        const systemInstruction = buildChloeSystemInstruction(settings, db.getMemories(userId), db.getSkills());
        const completion = await providerManager.generateWithFailover({
          provider: activeProv,
          systemPrompt: systemInstruction,
          messages: [{ role: 'user', content: message || 'Analyse cette image' }],
          image,
        });

        if (completion.text) {
          db.recordUsage(250);
          const assistantMsg = db.addMessage(
            conversationId,
            {
              role: 'assistant',
              content: completion.text,
              agentInvolved: specializedAgent,
            },
            userId
          );
          db.log(userId, specializedAgent.toUpperCase(), `Réponse générée via ${completion.providerUsed} (${completion.modelUsed})`, 'LEVEL_1_CONSULTATION', 'success', `Secours utilisés : ${completion.fallbackCount}`);
          return res.json(assistantMsg);
        }
      } catch (err: any) {
        if (/HTTP 401|HTTP 403|Erreur 401|Erreur 403/.test(String(err?.message || err))) throw err;
        console.warn(`Fournisseurs externes indisponibles, tentative Gemini:`, err.message);
      }
    }
"""
replace_once('server/routes.ts', old_external, new_external, 'routage explicite et secours fournisseur')

old_error_flag = """    const is429 = /429|quota|RESOURCE_EXHAUSTED/i.test(errStr);

    // 1. Try automatic failover to another configured provider if 429 quota exhaustion occurred
    if (is429) {
      const altProvider = providerManager.getAvailableAlternativeProvider();
      if (altProvider) {
        try {
          const settings = db.getSettings();
          const systemInstruction = buildChloeSystemInstruction(settings, db.getMemories(userId), db.getSkills());
          const completion = await providerManager.generateChatCompletion({
            systemPrompt: systemInstruction,
            messages: [{ role: 'user', content: req.body?.message || 'Bonjour' }],
            image: req.body?.image,
          });

          if (completion.text) {
            db.log(userId, 'BASCULE_AUTO', `Quota Gemini atteint. Bascule automatique vers ${altProvider} (${completion.modelUsed})`, 'LEVEL_1_CONSULTATION', 'success', 'Continuité assurée');
            const assistantMsg = db.addMessage(
              req.body?.conversationId,
              {
                role: 'assistant',
                content: `${completion.text}\\n\\n*(⚡ Note : Quota Gemini temporairement épuisé. Réponse assurée via ${altProvider.toUpperCase()}).*`,
              },
              userId
            );
            return res.json(assistantMsg);
          }
        } catch (failoverErr: any) {
          console.warn('Failover provider error:', failoverErr.message);
        }
      }

      // 2. If no alternative provider or failover failed, respond with a helpful assistant message
      db.log(userId, 'ORCHESTRATEUR', 'Quota Gemini dépassé (429 RESOURCE_EXHAUSTED)', 'LEVEL_1_CONSULTATION', 'warning', 'Quota atteint');
"""
new_error_flag = """    const isAuthenticationFailure = /(?:HTTP|Erreur)\\s*(?:401|403)/i.test(errStr);
    const isTransientProviderFailure = !isAuthenticationFailure && /429|408|5\\d\\d|quota|RESOURCE_EXHAUSTED|timeout|timed out|aborted|ECONNRESET|EAI_AGAIN|network|fetch failed/i.test(errStr);

    // Automatic failover from Gemini to a configured OpenAI/NVIDIA/OpenRouter provider.
    if (isTransientProviderFailure) {
      try {
        const settings = db.getSettings();
        const systemInstruction = buildChloeSystemInstruction(settings, db.getMemories(userId), db.getSkills());
        const completion = await providerManager.generateWithFailover({
          provider: 'gemini',
          systemPrompt: systemInstruction,
          messages: [{ role: 'user', content: req.body?.message || 'Bonjour' }],
          image: req.body?.image,
        });

        if (completion.text) {
          db.log(userId, 'BASCULE_AUTO', `Secours automatique vers ${completion.providerUsed} (${completion.modelUsed})`, 'LEVEL_1_CONSULTATION', 'success', `Fournisseurs de secours utilisés : ${completion.fallbackCount}`);
          const assistantMsg = db.addMessage(
            req.body?.conversationId,
            {
              role: 'assistant',
              content: `${completion.text}\\n\\n*(⚡ Réponse assurée via ${completion.providerUsed.toUpperCase()} après indisponibilité temporaire du moteur principal.)*`,
            },
            userId
          );
          return res.json(assistantMsg);
        }
      } catch (failoverErr: any) {
        console.warn('Failover providers error:', failoverErr.message);
      }

      // No configured provider could complete the request. Do not claim a successful fallback.
      db.log(userId, 'ORCHESTRATEUR', 'Tous les fournisseurs IA configurés sont temporairement indisponibles', 'LEVEL_1_CONSULTATION', 'warning', errStr);
"""
replace_once('server/routes.ts', old_error_flag, new_error_flag, 'failover Gemini sur quota, timeout et erreurs serveur')

replace_once(
    'server/routes.ts',
    "⚠️ **Limite de quota atteinte sur Google Gemini (Erreur 429 - Limite temporaire)**",
    "⚠️ **Le moteur IA principal est momentanément indisponible**",
    'message d’indisponibilité générique',
)
replace_once(
    'server/routes.ts',
    "Le quota gratuit de votre clé Google Gemini actuelle a été temporairement dépassé.",
    "Le service peut être en quota, en maintenance ou rencontrer une erreur réseau/serveur.",
    'explication des erreurs réseau et quota',
)
replace_once(
    'server/routes.ts',
    '4. Ou patientez quelques minutes le temps que Google réinitialise votre quota.',
    '4. Réessayez dans quelques minutes ou vérifiez le statut du fournisseur sélectionné.',
    'conseil générique après indisponibilité',
)

# Avoid the UI implying that an untested key is online.
replace_once(
    'server/routes.ts',
    """apiRouter.post('/providers/select', (req: Request, res: Response) => {
  const { id, model } = req.body;
  if (!id) return res.status(400).json({ error: 'Fournisseur manquant.' });
  providerManager.setActiveProvider(id, model);
  res.json(providerManager.getProvidersInfo());
});
""",
    """apiRouter.post('/providers/select', (req: Request, res: Response) => {
  const { id, model } = req.body;
  if (!id) return res.status(400).json({ error: 'Fournisseur manquant.' });
  try {
    providerManager.setActiveProvider(id, model);
    res.json(providerManager.getProvidersInfo());
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Impossible de sélectionner ce fournisseur.' });
  }
});

apiRouter.post('/providers/model', (req: Request, res: Response) => {
  const { id, model } = req.body;
  if (!id || !model) return res.status(400).json({ error: 'Fournisseur et modèle requis.' });
  try {
    providerManager.setProviderModel(id, model);
    res.json(providerManager.getProvidersInfo());
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'Impossible de modifier le modèle.' });
  }
});
""",
    'endpoint séparé pour changer le modèle sans activer le fournisseur',
)

# Make key-saving failures explicit to the frontend (including missing encryption config).
replace_once(
    'server/routes.ts',
    """apiRouter.post('/providers/key', (req: Request, res: Response) => {
  const { id, key } = req.body;
  if (!id || typeof key !== 'string') {
    return res.status(400).json({ error: 'Fournisseur ou clé manquant.' });
  }
  const result = providerManager.setProviderKey(id, key);
  res.json(result);
});
""",
    """apiRouter.post('/providers/key', (req: Request, res: Response) => {
  const { id, key } = req.body;
  if (!id || typeof key !== 'string') {
    return res.status(400).json({ error: 'Fournisseur ou clé manquant.' });
  }
  try {
    const result = providerManager.setProviderKey(id, key);
    res.json(result);
  } catch (error: any) {
    res.status(400).json({ error: error.message || 'La clé API n’a pas pu être sauvegardée.' });
  }
});
""",
    'sauvegarde clé avec retour d’erreur réel',
)

# Settings: show cards even if the API has not loaded, and show load/save errors.
insert = """const PROVIDER_FALLBACKS: AIProviderConfig[] = [
  { id: 'gemini', name: 'Google Gemini', endpoint: 'Google GenAI Cloud', description: 'Modèle multimodal Google.', keyUrl: 'https://aistudio.google.com/app/apikey', hasKey: false, maskedKey: '', status: 'not_configured', models: ['gemini-3.8-flash', 'gemini-4-argon', 'gemini-3.1-flash-lite'], selectedModel: 'gemini-3.8-flash' },
  { id: 'openai', name: 'OpenAI', endpoint: 'https://api.openai.com/v1', description: 'Modèles OpenAI.', keyUrl: 'https://platform.openai.com/api-keys', hasKey: false, maskedKey: '', status: 'not_configured', models: ['gpt-4o', 'gpt-4o-mini', 'o3-mini', 'gpt-4.5-preview'], selectedModel: 'gpt-4o' },
  { id: 'nvidia', name: 'NVIDIA NIM', endpoint: 'https://integrate.api.nvidia.com/v1', description: 'Modèles NVIDIA NIM.', keyUrl: 'https://build.nvidia.com', hasKey: false, maskedKey: '', status: 'not_configured', models: ['meta/llama-3.3-70b-instruct', 'mistralai/mistral-large-2-instruct', 'deepseek-ai/deepseek-r1', 'nvidia/llama-3.1-nemotron-70b-instruct'], selectedModel: 'meta/llama-3.3-70b-instruct' },
  { id: 'openrouter', name: 'OpenRouter', endpoint: 'https://openrouter.ai/api/v1', description: 'Passerelle multi-fournisseurs.', keyUrl: 'https://openrouter.ai/keys', hasKey: false, maskedKey: '', status: 'not_configured', models: ['deepseek/deepseek-r1', 'anthropic/claude-3.5-sonnet', 'meta-llama/llama-3.3-70b-instruct', 'google/gemini-2.0-flash-001', 'openai/gpt-4o'], selectedModel: 'deepseek/deepseek-r1' },
];

"""
replace_once(
    'src/components/SettingsView.tsx',
    "interface SettingsViewProps {",
    insert + "interface SettingsViewProps {",
    'modèles fournisseurs visibles même pendant le chargement',
)
replace_once(
    'src/components/SettingsView.tsx',
    "  const [providers, setProviders] = useState<AIProviderConfig[]>([]);",
    "  const [providers, setProviders] = useState<AIProviderConfig[]>(PROVIDER_FALLBACKS);\n  const [providersError, setProvidersError] = useState<string | null>(null);",
    'cartes fournisseurs initialisées',
)
replace_once(
    'src/components/SettingsView.tsx',
    """  const fetchProviders = async () => {
    try {
      const res = await fetch('/api/providers');
      if (res.ok) {
        const data = await res.json();
        setProviders(data.providers || []);
        setActiveProvider(data.activeProvider || 'gemini');
        setActiveModel(data.activeModel || 'gemini-3.8-flash');
      }
    } catch (e) {
      console.warn('Erreur chargement providers:', e);
    }
  };
""",
    """  const fetchProviders = async () => {
    try {
      const res = await fetch('/api/providers');
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setProviders(Array.isArray(data.providers) && data.providers.length ? data.providers : PROVIDER_FALLBACKS);
      setActiveProvider(data.activeProvider || 'gemini');
      setActiveModel(data.activeModel || 'gemini-3.8-flash');
      setProvidersError(null);
    } catch (e: any) {
      console.warn('Erreur chargement providers:', e);
      setProvidersError(`Impossible de charger les fournisseurs : ${e.message || 'serveur API inaccessible'}. Vérifiez l’URL API et le backend HTTPS.`);
      setProviders(prev => prev.length ? prev : PROVIDER_FALLBACKS);
    }
  };
""",
    'erreurs de chargement fournisseurs visibles',
)
replace_once(
    'src/components/SettingsView.tsx',
    """      if (res.ok) {
        setKeyInputs(prev => ({ ...prev, [id]: '' }));
        await fetchProviders();
      }
    } catch (e) {
      console.error('Erreur sauvegarde clé:', e);
    } finally {
""",
    """      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setKeyInputs(prev => ({ ...prev, [id]: '' }));
      setProvidersError(null);
      await fetchProviders();
    } catch (e: any) {
      console.error('Erreur sauvegarde clé:', e);
      setProvidersError(`Sauvegarde impossible : ${e.message || 'erreur serveur'}`);
    } finally {
""",
    'retour d’erreur sauvegarde clé',
)
replace_once(
    'src/components/SettingsView.tsx',
    """      if (res.ok) {
        const data = await res.json();
        setActiveProvider(data.activeProvider);
        setActiveModel(data.activeModel);
        setProviders(data.providers || []);
      }
    } catch (e) {
      console.error('Erreur sélection provider:', e);
    }
  };
""",
    """      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setActiveProvider(data.activeProvider);
      setActiveModel(data.activeModel);
      setProviders(data.providers || PROVIDER_FALLBACKS);
      setProvidersError(null);
    } catch (e: any) {
      console.error('Erreur sélection provider:', e);
      setProvidersError(`Activation impossible : ${e.message || 'erreur serveur'}`);
    }
  };

  const handleSetProviderModel = async (id: AIProviderId, model: string) => {
    try {
      const res = await fetch('/api/providers/model', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id, model }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
      setProviders(data.providers || PROVIDER_FALLBACKS);
      setActiveProvider(data.activeProvider || activeProvider);
      setActiveModel(data.activeModel || activeModel);
      setProvidersError(null);
    } catch (e: any) {
      setProvidersError(`Modification du modèle impossible : ${e.message || 'erreur serveur'}`);
    }
  };
""",
    'séparation sélection moteur et modèle',
)
replace_once(
    'src/components/SettingsView.tsx',
    "onChange={e => handleSelectProvider(p.id, e.target.value)}",
    "onChange={e => handleSetProviderModel(p.id, e.target.value)}",
    'changer un modèle sans activer son fournisseur',
)
replace_once(
    'src/components/SettingsView.tsx',
    """          <span className=\"text-[10px] px-2.5 py-1 rounded-full bg-emerald-950/60 text-emerald-300 border border-emerald-500/40 font-semibold animate-pulse\">
            En ligne
          </span>
""",
    """          <span className=\"text-[10px] px-2.5 py-1 rounded-full bg-slate-800/70 text-slate-300 border border-slate-600/40 font-semibold\">
            Moteur sélectionné
          </span>
""",
    'suppression du faux statut En ligne',
)

# Insert API diagnostic below the active engine banner.
replace_once(
    'src/components/SettingsView.tsx',
    """        {/* Provider Cards */}
""",
    """        {providersError && (
          <div role=\"alert\" className=\"p-3 rounded-xl bg-amber-950/30 border border-amber-500/40 text-amber-200 text-xs leading-relaxed\">
            {providersError}
          </div>
        )}

        {/* Provider Cards */}
""",
    'affichage des erreurs API dans les paramètres',
)

# Avatar: default to a larger, more visible presentation.
replace_once(
    'src/types/avatar.ts',
    "  size: 'medium',\n  position: 'center',\n  visibility: 'normal',",
    "  size: 'large',\n  position: 'center',\n  visibility: 'high',",
    'avatar grand et visible par défaut',
)
replace_once(
    'src/components/avatar/AvatarPresence.tsx',
    """      case 'large':
        return isSidePanel ? 'h-[85vh] max-h-[750px]' : 'h-[86vh] max-h-[820px]';
      case 'medium':
      default:
        return isSidePanel ? 'h-[70vh] max-h-[620px]' : 'h-[72vh] max-h-[680px]';
""",
    """      case 'large':
        return isSidePanel ? 'h-[88dvh] max-h-[900px]' : 'h-[92dvh] max-h-[980px]';
      case 'medium':
      default:
        return isSidePanel ? 'h-[78dvh] max-h-[760px]' : 'h-[84dvh] max-h-[900px]';
""",
    'avatar agrandi avec hauteur dynamique mobile',
)
replace_once(
    'src/components/avatar/AvatarPresence.tsx',
    """      case 'low':
        return 'opacity-25 hover:opacity-40 transition-opacity duration-500';
      case 'high':
        return 'opacity-85';
      case 'normal':
      default:
        return 'opacity-55';
""",
    """      case 'low':
        return 'opacity-45 hover:opacity-60 transition-opacity duration-500';
      case 'high':
        return 'opacity-95';
      case 'normal':
      default:
        return 'opacity-80';
""",
    'visibilité avatar améliorée',
)
replace_once(
    'src/components/ChatView.tsx',
    """        {!isSideModeActive && avatar.preferences.enabled && (
          <div className=\"absolute inset-0 z-0 pointer-events-none flex items-end justify-center pb-12 sm:pb-16 overflow-hidden\">
""",
    """        {avatar.preferences.enabled && (
          <div className={`absolute inset-0 z-0 pointer-events-none flex items-end justify-center pb-12 sm:pb-16 overflow-hidden ${isSideModeActive ? 'md:hidden' : ''}`}>
""",
    'avatar du mode latéral visible sur téléphone',
)
replace_once(
    'src/components/ChatView.tsx',
    '<span>Tests 20/20</span>',
    '<span>Tests & validation</span>',
    'suppression du score de tests statique',
)

# CORS for a remote backend called from an APK/WebView or an independently hosted frontend.
replace_once(
    'server.ts',
    """// Body parsers with generous limit for multimodal base64 photos from Samsung Galaxy S24
app.use(express.json({ limit: '25mb' }));
""",
    """// Restrict cross-origin API access to explicitly configured frontend origins.
const allowedOrigins = (process.env.CHLOE_ALLOWED_ORIGINS || '')
  .split(',').map(value => value.trim()).filter(Boolean);
app.use((req, res, next) => {
  const origin = req.headers.origin;
  if (origin && (allowedOrigins.includes(origin) || allowedOrigins.includes('*'))) {
    res.setHeader('Access-Control-Allow-Origin', allowedOrigins.includes('*') ? '*' : origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,PUT,PATCH,DELETE,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  }
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

// Body parsers with generous limit for multimodal base64 photos from Samsung Galaxy S24
app.use(express.json({ limit: '25mb' }));
""",
    'CORS contrôlé par liste d’origines',
)

# Gradle: align old transitive Kotlin stdlib artifacts to avoid duplicate-class build failure.
replace_once(
    'android/build.gradle',
    """allprojects {
    repositories {
        google()
        mavenCentral()
    }
}
""",
    """allprojects {
    repositories {
        google()
        mavenCentral()
    }
}

// Resolve older Kotlin stdlib/jdk7/jdk8 transitive artifacts consistently.
subprojects {
    configurations.configureEach {
        resolutionStrategy.force(
            'org.jetbrains.kotlin:kotlin-stdlib:1.8.22',
            'org.jetbrains.kotlin:kotlin-stdlib-jdk7:1.8.22',
            'org.jetbrains.kotlin:kotlin-stdlib-jdk8:1.8.22'
        )
    }
}
""",
    'alignement des dépendances Kotlin Android',
)

# Write the staged files only after all expected source anchors were validated.
for relative, content in modified_files.items():
    target = root / relative
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')
print(f'OK: {len(modified_files)} fichier(s) écrit(s)')

# Remove sensitive files from the Git index without deleting local working copies.
import subprocess
private_paths = ['data/chloe_store.json', 'data/backups/chloe_store_backup_v1.json', 'data/ai_providers.json', 'android/local.properties']
for relative in private_paths:
    tracked = subprocess.run(['git', 'ls-files', '--error-unmatch', relative], cwd=root, capture_output=True, text=True)
    if tracked.returncode == 0:
        removed = subprocess.run(['git', 'rm', '--cached', '--', relative], cwd=root, capture_output=True, text=True)
        if removed.returncode != 0:
            raise SystemExit(f'Impossible de retirer {relative} de l’index Git : {removed.stderr.strip()}')
        print(f'OK: {relative} retiré de l’index Git (fichier local conservé)')

print('\nTerminé. Vérifie le diff puis lance npm ci, npm run lint, npm test et la compilation Android.')
