import React, { Suspense, useRef, useState, useEffect, useMemo } from 'react';
import { Canvas, useFrame, useThree } from '@react-three/fiber';
import { OrbitControls, ContactShadows, Html, useGLTF, useAnimations } from '@react-three/drei';
import * as THREE from 'three';
import { useGlobalAvatar, useAvatarAnimationBridge } from '../../context/AvatarContext.tsx';
import { useAudioLipSync } from '../../hooks/useAudioLipSync.ts';
import { AvatarState } from '../../types/avatar.ts';
import {
  Mic,
  MicOff,
  Sparkles,
  Volume2,
  Brain,
  RotateCcw,
  Eye,
  Sliders,
  Check,
  Image as ImageIcon
} from 'lucide-react';

interface ChloeAvatarProps {
  modelUrl?: string;
  className?: string;
  interactive?: boolean;
  showControls?: boolean;
  onTap?: () => void;
  showOfficialPhotoToggle?: boolean;
}

/**
 * Procedural High-Detail 3D Chloé Character Rig with Morph Targets
 * Faithful to her official portrait (lavender turtleneck sweater, violet pants, brown wavy hair)
 */
function ProceduralChloeModel({
  state,
  isSpeaking,
  onApplyLipSync,
}: {
  state: AvatarState;
  isSpeaking: boolean;
  onApplyLipSync: (root: THREE.Object3D) => void;
}) {
  const rootGroupRef = useRef<THREE.Group>(null);
  const headRef = useRef<THREE.Group>(null);
  const spineRef = useRef<THREE.Group>(null);
  const leftArmRef = useRef<THREE.Group>(null);
  const rightArmRef = useRef<THREE.Group>(null);
  const faceMeshRef = useRef<THREE.Mesh>(null);
  const mouthMeshRef = useRef<THREE.Mesh>(null);
  const leftEyeRef = useRef<THREE.Mesh>(null);
  const rightEyeRef = useRef<THREE.Mesh>(null);

  // Blendshape dictionary setup for face mesh
  useEffect(() => {
    if (faceMeshRef.current) {
      const mesh = faceMeshRef.current;
      // Define morph target dictionary
      mesh.morphTargetDictionary = {
        jawOpen: 0,
        mouthOpen: 1,
        viseme_aa: 2,
        viseme_O: 3,
        viseme_E: 4,
        viseme_I: 5,
        viseme_CH: 6,
        mouthSmile: 7,
        mouthPucker: 8,
      };
      mesh.morphTargetInfluences = [0, 0, 0, 0, 0, 0, 0, 0.15, 0];
    }
  }, []);

  // Frame animation loop (breathing, blinking, head-tilting, posture shifts)
  useFrame(({ clock, pointer }) => {
    const t = clock.getElapsedTime();
    if (!rootGroupRef.current) return;

    // 1. Natural breathing on spine
    if (spineRef.current) {
      const breathFreq = state === 'listening' ? 1.8 : 2.2;
      const breathAmp = state === 'listening' ? 0.015 : 0.022;
      spineRef.current.position.y = Math.sin(t * breathFreq) * breathAmp;
      spineRef.current.rotation.x = Math.sin(t * breathFreq) * 0.012;
    }

    // 2. Head subtle movement & pointer tracking
    if (headRef.current) {
      let targetRotY = pointer.x * 0.25;
      let targetRotX = -pointer.y * 0.15;
      let targetRotZ = 0;

      // State-specific postures
      if (state === 'thinking') {
        targetRotX += 0.12; // tilted slightly up/right
        targetRotY += 0.18;
        targetRotZ = -0.05;
      } else if (state === 'listening') {
        targetRotX += 0.05; // attentive nod
        targetRotZ = 0.04;
      } else if (state === 'greeting' || state === 'happy') {
        targetRotX += Math.sin(t * 3.5) * 0.04; // playful nod
      }

      headRef.current.rotation.y = THREE.MathUtils.lerp(headRef.current.rotation.y, targetRotY, 0.08);
      headRef.current.rotation.x = THREE.MathUtils.lerp(headRef.current.rotation.x, targetRotX, 0.08);
      headRef.current.rotation.z = THREE.MathUtils.lerp(headRef.current.rotation.z, targetRotZ, 0.08);
    }

    // 3. Natural Blinking Loop (~ every 3.8s)
    const blinkCycle = (t % 3.8);
    const isBlinking = blinkCycle > 3.65 && blinkCycle < 3.8;
    const eyeScaleY = isBlinking ? 0.1 : 1.0;
    if (leftEyeRef.current) leftEyeRef.current.scale.y = eyeScaleY;
    if (rightEyeRef.current) rightEyeRef.current.scale.y = eyeScaleY;

    // 4. Arms posture based on avatar state
    if (leftArmRef.current && rightArmRef.current) {
      let leftAngle = 0.15 + Math.sin(t * 1.5) * 0.02;
      let rightAngle = -0.15 - Math.sin(t * 1.5) * 0.02;

      if (state === 'thinking') {
        // Right hand slightly raised near chest
        rightAngle = -0.85 + Math.sin(t * 2) * 0.03;
        leftAngle = 0.25;
      } else if (state === 'speaking') {
        // Expressive gestures
        rightAngle = -0.45 + Math.sin(t * 3.2) * 0.12;
        leftAngle = 0.35 + Math.cos(t * 2.8) * 0.08;
      } else if (state === 'greeting') {
        rightAngle = -1.2 + Math.sin(t * 6) * 0.15; // Waving hand!
      }

      rightArmRef.current.rotation.z = THREE.MathUtils.lerp(rightArmRef.current.rotation.z, rightAngle, 0.06);
      leftArmRef.current.rotation.z = THREE.MathUtils.lerp(leftArmRef.current.rotation.z, leftAngle, 0.06);
    }

    // 5. Real-time lip-sync morph targets application
    if (faceMeshRef.current) {
      onApplyLipSync(faceMeshRef.current);

      // Procedural mouth mesh opening if present
      if (mouthMeshRef.current && faceMeshRef.current.morphTargetInfluences) {
        const jawOpen = faceMeshRef.current.morphTargetInfluences[0] || 0;
        const smile = faceMeshRef.current.morphTargetInfluences[7] || 0.15;
        mouthMeshRef.current.scale.y = 0.4 + jawOpen * 1.2;
        mouthMeshRef.current.scale.x = 0.9 + smile * 0.4;
      }
    }
  });

  return (
    <group ref={rootGroupRef} position={[0, -1.5, 0]}>
      {/* Lower Body: Violet Flared Pants & Boots */}
      <group position={[0, 0, 0]}>
        {/* Left Leg */}
        <mesh position={[-0.22, 0.8, 0]} castShadow>
          <cylinderGeometry args={[0.13, 0.17, 1.4, 24]} />
          <meshStandardMaterial color="#371B58" roughness={0.65} metalness={0.1} />
        </mesh>
        {/* Right Leg */}
        <mesh position={[0.22, 0.8, 0]} castShadow>
          <cylinderGeometry args={[0.13, 0.17, 1.4, 24]} />
          <meshStandardMaterial color="#371B58" roughness={0.65} metalness={0.1} />
        </mesh>
        {/* Left Boot */}
        <mesh position={[-0.22, 0.08, 0.05]} castShadow>
          <boxGeometry args={[0.2, 0.18, 0.38]} />
          <meshStandardMaterial color="#1a0f26" roughness={0.35} metalness={0.3} />
        </mesh>
        {/* Right Boot */}
        <mesh position={[0.22, 0.08, 0.05]} castShadow>
          <boxGeometry args={[0.2, 0.18, 0.38]} />
          <meshStandardMaterial color="#1a0f26" roughness={0.35} metalness={0.3} />
        </mesh>
        {/* Waist & Belt with seam */}
        <mesh position={[0, 1.5, 0]} castShadow>
          <cylinderGeometry args={[0.3, 0.32, 0.28, 24]} />
          <meshStandardMaterial color="#30154e" roughness={0.6} metalness={0.15} />
        </mesh>
      </group>

      {/* Spine / Torso (Breathing animated) */}
      <group ref={spineRef} position={[0, 1.62, 0]}>
        {/* Lavender Turtleneck Sweater */}
        <mesh position={[0, 0.45, 0]} castShadow>
          <cylinderGeometry args={[0.32, 0.28, 0.85, 24]} />
          <meshStandardMaterial
            color="#A78BFA"
            roughness={0.75}
            metalness={0.05}
          />
        </mesh>

        {/* Turtleneck Collar */}
        <mesh position={[0, 0.92, 0]} castShadow>
          <torusGeometry args={[0.14, 0.065, 16, 24]} />
          <meshStandardMaterial color="#906EE8" roughness={0.8} />
        </mesh>

        {/* Left Arm & Hand */}
        <group ref={leftArmRef} position={[-0.38, 0.75, 0]}>
          {/* Upper Arm */}
          <mesh position={[-0.1, -0.32, 0]} castShadow>
            <cylinderGeometry args={[0.085, 0.075, 0.65, 16]} />
            <meshStandardMaterial color="#A78BFA" roughness={0.75} />
          </mesh>
          {/* Forearm */}
          <mesh position={[-0.14, -0.85, 0]} castShadow>
            <cylinderGeometry args={[0.075, 0.065, 0.55, 16]} />
            <meshStandardMaterial color="#A78BFA" roughness={0.75} />
          </mesh>
          {/* Hand */}
          <mesh position={[-0.14, -1.18, 0]} castShadow>
            <sphereGeometry args={[0.065, 16, 16]} />
            <meshStandardMaterial color="#f6d5be" roughness={0.5} />
          </mesh>
        </group>

        {/* Right Arm & Hand */}
        <group ref={rightArmRef} position={[0.38, 0.75, 0]}>
          {/* Upper Arm */}
          <mesh position={[0.1, -0.32, 0]} castShadow>
            <cylinderGeometry args={[0.085, 0.075, 0.65, 16]} />
            <meshStandardMaterial color="#A78BFA" roughness={0.75} />
          </mesh>
          {/* Forearm */}
          <mesh position={[0.14, -0.85, 0]} castShadow>
            <cylinderGeometry args={[0.075, 0.065, 0.55, 16]} />
            <meshStandardMaterial color="#A78BFA" roughness={0.75} />
          </mesh>
          {/* Hand */}
          <mesh position={[0.14, -1.18, 0]} castShadow>
            <sphereGeometry args={[0.065, 16, 16]} />
            <meshStandardMaterial color="#f6d5be" roughness={0.5} />
          </mesh>
        </group>

        {/* Head & Face Group */}
        <group ref={headRef} position={[0, 1.25, 0]}>
          {/* Neck */}
          <mesh position={[0, -0.12, 0]} castShadow>
            <cylinderGeometry args={[0.09, 0.1, 0.22, 16]} />
            <meshStandardMaterial color="#f6d5be" roughness={0.5} />
          </mesh>

          {/* Face Head Mesh (Equipped with Morph Targets for Visemes / Lip-Sync) */}
          <mesh ref={faceMeshRef} position={[0, 0.15, 0]} castShadow>
            <sphereGeometry args={[0.26, 32, 32]} />
            <meshStandardMaterial color="#fbe0cb" roughness={0.42} />
          </mesh>

          {/* Chin refinement */}
          <mesh position={[0, 0.02, 0.14]}>
            <sphereGeometry args={[0.1, 16, 16]} />
            <meshStandardMaterial color="#f6d5be" roughness={0.45} />
          </mesh>

          {/* Left Eye & Iris */}
          <mesh ref={leftEyeRef} position={[-0.09, 0.17, 0.22]}>
            <sphereGeometry args={[0.04, 16, 16]} />
            <meshStandardMaterial color="#3d2314" roughness={0.2} metalness={0.1} />
          </mesh>
          {/* Right Eye & Iris */}
          <mesh ref={rightEyeRef} position={[0.09, 0.17, 0.22]}>
            <sphereGeometry args={[0.04, 16, 16]} />
            <meshStandardMaterial color="#3d2314" roughness={0.2} metalness={0.1} />
          </mesh>

          {/* Eyelashes / Brows */}
          <mesh position={[-0.09, 0.23, 0.23]} rotation={[0, 0, 0.08]}>
            <boxGeometry args={[0.09, 0.015, 0.02]} />
            <meshBasicMaterial color="#2d1a0e" />
          </mesh>
          <mesh position={[0.09, 0.23, 0.23]} rotation={[0, 0, -0.08]}>
            <boxGeometry args={[0.09, 0.015, 0.02]} />
            <meshBasicMaterial color="#2d1a0e" />
          </mesh>

          {/* Nose */}
          <mesh position={[0, 0.13, 0.26]} rotation={[0.2, 0, 0]}>
            <coneGeometry args={[0.032, 0.09, 12]} />
            <meshStandardMaterial color="#f4c8b0" roughness={0.5} />
          </mesh>

          {/* Mouth / Lips (Modulated by Lip-Sync) */}
          <mesh ref={mouthMeshRef} position={[0, 0.05, 0.24]}>
            <capsuleGeometry args={[0.02, 0.06, 8, 16]} />
            <meshStandardMaterial color="#d45b78" roughness={0.35} />
          </mesh>

          {/* Brown Wavy Bob Hair (Chloé's signature hairstyle) */}
          <group position={[0, 0.2, 0]}>
            {/* Top & Back Volume */}
            <mesh position={[0, 0.04, -0.05]}>
              <sphereGeometry args={[0.29, 24, 24]} />
              <meshStandardMaterial color="#4A2E1B" roughness={0.7} />
            </mesh>
            {/* Left Wavy Side Locks */}
            <mesh position={[-0.24, -0.15, 0.05]} rotation={[0, 0, 0.2]}>
              <capsuleGeometry args={[0.08, 0.38, 12, 16]} />
              <meshStandardMaterial color="#55341E" roughness={0.65} />
            </mesh>
            {/* Right Wavy Side Locks */}
            <mesh position={[0.24, -0.15, 0.05]} rotation={[0, 0, -0.2]}>
              <capsuleGeometry args={[0.08, 0.38, 12, 16]} />
              <meshStandardMaterial color="#55341E" roughness={0.65} />
            </mesh>
            {/* Soft Front Bangs / Fringe */}
            <mesh position={[0, 0.15, 0.24]} rotation={[0.3, 0, 0]}>
              <capsuleGeometry args={[0.045, 0.22, 12, 16]} />
              <meshStandardMaterial color="#5C3B24" roughness={0.65} />
            </mesh>
          </group>
        </group>
      </group>
    </group>
  );
}

/**
 * GLTF/GLB Model Loader Subcomponent:
 * Tries to load GLB if specified. If not available, smoothly displays ProceduralChloeModel.
 */
function GLBModelRenderer({
  url,
  state,
  isSpeaking,
  onApplyLipSync,
}: {
  url: string;
  state: AvatarState;
  isSpeaking: boolean;
  onApplyLipSync: (root: THREE.Object3D) => void;
}) {
  const group = useRef<THREE.Group>(null);
  const gltf = useGLTF(url);
  const { actions, names } = useAnimations(gltf.animations, group);

  // Hook up animation bridge for transitions between states
  useAvatarAnimationBridge(actions, names);

  useFrame(() => {
    if (group.current) {
      onApplyLipSync(group.current);
    }
  });

  return (
    <group ref={group} dispose={null} position={[0, -1.4, 0]}>
      <primitive object={gltf.scene} />
    </group>
  );
}

/**
 * Main 3D Canvas Scene
 */
function AvatarScene({
  modelUrl,
  state,
  isSpeaking,
  onApplyLipSync,
}: {
  modelUrl?: string;
  state: AvatarState;
  isSpeaking: boolean;
  onApplyLipSync: (root: THREE.Object3D) => void;
}) {
  const [hasGLTFError, setHasGLTFError] = useState(false);

  return (
    <>
      {/* Studio Lighting Setup for PBR Realism */}
      <ambientLight intensity={0.8} />

      {/* Main Warm Key Light */}
      <directionalLight
        position={[3, 4, 3]}
        intensity={1.25}
        castShadow
        shadow-mapSize={[1024, 1024]}
        shadow-camera-near={0.5}
        shadow-camera-far={10}
      />

      {/* Cool Fill Light */}
      <directionalLight position={[-3, 2, 2]} intensity={0.5} color="#c7d2fe" />

      {/* Neon Purple Rim / Backlight for Chloé's Cyber Aura */}
      <directionalLight position={[0, 2.5, -3.5]} intensity={2.4} color="#c084fc" />

      {/* Subtle floor bounce */}
      <pointLight position={[0, -1, 1]} intensity={0.3} color="#f3e8ff" />

      {/* Model Loading with Fallback */}
      <Suspense
        fallback={
          <Html center>
            <div className="flex flex-col items-center gap-2 p-3 bg-purple-950/80 backdrop-blur-md rounded-2xl border border-purple-500/40 text-purple-200 text-xs shadow-xl min-w-[170px]">
              <div className="w-5 h-5 border-2 border-purple-400 border-t-transparent rounded-full animate-spin" />
              <span className="font-medium">Initialisation 3D Chloé...</span>
            </div>
          </Html>
        }
      >
        {modelUrl && !hasGLTFError ? (
          <GLBModelRenderer
            url={modelUrl}
            state={state}
            isSpeaking={isSpeaking}
            onApplyLipSync={onApplyLipSync}
          />
        ) : (
          <ProceduralChloeModel
            state={state}
            isSpeaking={isSpeaking}
            onApplyLipSync={onApplyLipSync}
          />
        )}
      </Suspense>

      {/* Ground Contact Shadow */}
      <ContactShadows
        position={[0, -1.48, 0]}
        opacity={0.65}
        scale={4.5}
        blur={1.6}
        far={2.2}
      />

      {/* Camera Controls with Mobile Safety Constraints */}
      <OrbitControls
        enableZoom={true}
        enablePan={false}
        minDistance={2.2}
        maxDistance={5.0}
        minPolarAngle={Math.PI / 3}
        maxPolarAngle={Math.PI / 1.85}
        minAzimuthAngle={-Math.PI / 3.5}
        maxAzimuthAngle={Math.PI / 3.5}
        target={[0, 0.1, 0]}
      />
    </>
  );
}

/**
 * Top-Level Exported ChloeAvatar Component
 */
export const ChloeAvatar: React.FC<ChloeAvatarProps> = ({
  modelUrl,
  className = '',
  interactive = true,
  showControls = true,
  onTap,
  showOfficialPhotoToggle = true,
}) => {
  const { state, setState, animationController } = useGlobalAvatar();
  const [showPhotoRef, setShowPhotoRef] = useState(false);
  const [micActiveState, setMicActiveState] = useState(false);

  // Initialize Web Audio Lip-Sync Hook
  const {
    visemes,
    volume,
    isMicActive,
    isAudioActive,
    startMic,
    stopMic,
    applyMorphTargets,
  } = useAudioLipSync({
    smoothing: 0.65,
    sensitivity: 1.5,
    autoSyncWithSpeechService: true,
  });

  const toggleMic = async () => {
    if (isMicActive) {
      stopMic();
      setMicActiveState(false);
    } else {
      const ok = await startMic();
      setMicActiveState(ok);
    }
  };

  const handleStateSelect = (targetState: AvatarState) => {
    setState(targetState);
  };

  return (
    <div className={`relative flex flex-col items-center justify-center w-full h-full select-none ${className}`}>
      {/* 3D R3F Canvas Container */}
      <div className="relative w-full h-full min-h-[380px] overflow-hidden rounded-3xl bg-radial from-[#15102a]/70 via-[#0a0817]/90 to-[#04020a]">
        {/* Ambient Pulsing Aura in background */}
        <div className="absolute inset-x-12 top-10 bottom-20 rounded-full bg-purple-600/15 blur-3xl pointer-events-none" />

        {/* Real-time WebGL Canvas */}
        <Canvas
          shadows
          camera={{ position: [0, 0.2, 3.8], fov: 38 }}
          gl={{
            antialias: true,
            alpha: true,
            powerPreference: 'high-performance',
            toneMapping: THREE.ACESFilmicToneMapping,
            toneMappingExposure: 1.1,
          }}
          className="w-full h-full cursor-grab active:cursor-grabbing"
          onClick={onTap}
        >
          <AvatarScene
            modelUrl={modelUrl}
            state={state}
            isSpeaking={state === 'speaking' || isAudioActive}
            onApplyLipSync={applyMorphTargets}
          />
        </Canvas>

        {/* Top-Right Quick Action Badges */}
        <div className="absolute top-3 right-3 z-20 flex items-center gap-1.5">
          {/* Microphone Live Lip-Sync Toggle */}
          <button
            onClick={toggleMic}
            className={`p-2 rounded-xl border text-xs font-medium flex items-center gap-1.5 backdrop-blur-md transition-all shadow-md active:scale-95 ${
              isMicActive
                ? 'bg-rose-500/25 border-rose-500/50 text-rose-300 animate-pulse'
                : 'bg-purple-950/60 border-purple-500/30 text-purple-200 hover:bg-purple-900/60'
            }`}
            title={isMicActive ? 'Microphone actif (lip-sync vocal en direct)' : 'Activer micro pour lip-sync en direct'}
          >
            {isMicActive ? <Mic className="w-3.5 h-3.5 text-rose-400" /> : <MicOff className="w-3.5 h-3.5 opacity-70" />}
            <span className="text-[11px] hidden sm:inline">
              {isMicActive ? 'Micro actif' : 'Lip-sync micro'}
            </span>
          </button>

          {/* Official Portrait Reference Toggle */}
          {showOfficialPhotoToggle && (
            <button
              onClick={() => setShowPhotoRef(prev => !prev)}
              className={`p-2 rounded-xl border text-xs font-medium flex items-center gap-1.5 backdrop-blur-md transition-all shadow-md active:scale-95 ${
                showPhotoRef
                  ? 'bg-purple-600 text-white border-purple-400'
                  : 'bg-purple-950/60 border-purple-500/30 text-purple-200 hover:bg-purple-900/60'
              }`}
              title="Voir l'image officielle haute résolution de Chloé"
            >
              <ImageIcon className="w-3.5 h-3.5 text-purple-300" />
              <span className="text-[11px] hidden sm:inline">Photo</span>
            </button>
          )}
        </div>

        {/* Top-Left Active State & Audio Indicator */}
        <div className="absolute top-3 left-3 z-20 flex flex-col gap-1.5">
          <div className="px-2.5 py-1 rounded-xl bg-purple-950/80 border border-purple-500/30 text-[11px] text-purple-200 font-medium backdrop-blur-md flex items-center gap-2 shadow-sm">
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
            </span>
            <span className="font-semibold text-white uppercase text-[10px] tracking-wider">3D Pipeline</span>
            <span className="text-slate-400">·</span>
            <span className="capitalize">{state}</span>
          </div>

          {/* Live Lip-Sync Viseme Bar */}
          {(isAudioActive || volume > 0.02) && (
            <div className="px-2 py-0.5 rounded-lg bg-black/60 border border-purple-500/20 text-[10px] text-purple-300 flex items-center gap-2 backdrop-blur-sm">
              <Volume2 className="w-3 h-3 text-fuchsia-400 animate-pulse" />
              <div className="w-16 h-1.5 bg-purple-950 rounded-full overflow-hidden">
                <div
                  className="h-full bg-gradient-to-r from-purple-400 to-fuchsia-400 transition-all duration-75"
                  style={{ width: `${Math.min(100, Math.round(volume * 100))}%` }}
                />
              </div>
              <span className="font-mono text-[9px] text-slate-400">
                {Math.round(volume * 100)}%
              </span>
            </div>
          )}
        </div>

        {/* Bottom Interactive Pose / State Bar */}
        {showControls && (
          <div className="absolute bottom-3 inset-x-3 z-20 flex items-center justify-center gap-1.5 p-1.5 rounded-2xl bg-[#090C19]/80 border border-purple-500/30 backdrop-blur-md overflow-x-auto">
            <span className="text-[10px] uppercase font-semibold tracking-wider text-purple-300 px-2 hidden sm:inline">
              États :
            </span>
            {(['idle', 'listening', 'thinking', 'speaking', 'greeting', 'happy'] as AvatarState[]).map(s => {
              const isActive = state === s;
              return (
                <button
                  key={s}
                  onClick={() => handleStateSelect(s)}
                  className={`px-2.5 py-1 rounded-xl text-[11px] font-medium transition-all shrink-0 active:scale-95 ${
                    isActive
                      ? 'bg-purple-600 text-white font-semibold shadow-md shadow-purple-950/60'
                      : 'bg-purple-950/40 text-slate-300 hover:text-white hover:bg-purple-900/40 border border-purple-500/20'
                  }`}
                >
                  {s === 'idle' && 'Veille'}
                  {s === 'listening' && 'Écoute'}
                  {s === 'thinking' && 'Réflexion'}
                  {s === 'speaking' && 'Parole'}
                  {s === 'greeting' && 'Saluer'}
                  {s === 'happy' && 'Sourire'}
                </button>
              );
            })}
          </div>
        )}

        {/* Modal Overlay: Official Assistant Portrait Image View */}
        {showPhotoRef && (
          <div className="absolute inset-0 z-30 bg-black/85 backdrop-blur-md p-4 flex flex-col items-center justify-center animate-in fade-in duration-200">
            <div className="relative max-w-sm w-full bg-[#0E1224] border border-purple-500/40 rounded-3xl p-4 shadow-2xl flex flex-col items-center">
              <div className="w-full flex items-center justify-between pb-2 mb-2 border-b border-purple-500/20">
                <div className="flex items-center gap-2">
                  <span className="w-2.5 h-2.5 rounded-full bg-emerald-400" />
                  <h4 className="font-bold text-white text-sm">Portrait Officiel de Chloé</h4>
                </div>
                <button
                  onClick={() => setShowPhotoRef(false)}
                  className="p-1 rounded-lg text-slate-400 hover:text-white bg-slate-800/60"
                >
                  ✕
                </button>
              </div>

              {/* Chloé's official full-body image */}
              <div className="relative w-full h-[52vh] max-h-[460px] rounded-2xl overflow-hidden bg-gradient-radial from-purple-900/30 to-black/60 flex items-center justify-center border border-purple-500/20">
                <img
                  src="/chloe-avatar-fullbody.webp"
                  alt="Portrait officiel de Chloé"
                  className="w-full h-full object-contain object-bottom drop-shadow-[0_10px_25px_rgba(168,85,247,0.4)]"
                  onError={(e) => {
                    const target = e.currentTarget;
                    if (!target.src.includes('chloe-avatar-fullbody_f3fa7d52.webp')) {
                      target.src = '/assets/aistudio/chloe-avatar-fullbody_f3fa7d52.webp';
                    }
                  }}
                />
              </div>

              <div className="w-full mt-3 text-center">
                <p className="text-xs text-purple-200 font-medium">
                  CHLOÉ AI — Assistante Virtuelle Personnelle
                </p>
                <p className="text-[11px] text-slate-400 mt-0.5">
                  Modèle 3D et expressions calibrés selon ce portrait de référence.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
