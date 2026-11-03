import React, { useEffect, useRef, useState, useCallback } from 'react';
import * as THREE from 'three';
import { AvatarState, AvatarPreferences } from '../../types/avatar.ts';
import { speechLipSync, VisemeState } from '../../services/speechLipSync.ts';

interface ChloeAvatar3DProps {
  state: AvatarState;
  preferences: AvatarPreferences;
  isSpeaking?: boolean;
  onTap?: () => void;
  className?: string;
  isSidePanel?: boolean;
}

export const ChloeAvatar3D: React.FC<ChloeAvatar3DProps> = ({
  state,
  preferences,
  isSpeaking = false,
  onTap,
  className = '',
  isSidePanel = false,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [webGLError, setWebGLError] = useState(false);
  const [isHovered, setIsHovered] = useState(false);
  const [interactiveFeedback, setInteractiveFeedback] = useState<string | null>(null);

  // References for animation state
  const stateRef = useRef<AvatarState>(state);
  const isSpeakingRef = useRef<boolean>(isSpeaking);
  const preferencesRef = useRef<AvatarPreferences>(preferences);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    isSpeakingRef.current = isSpeaking;
  }, [isSpeaking]);

  useEffect(() => {
    preferencesRef.current = preferences;
  }, [preferences]);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container || !canvas) return;

    let animationFrameId: number;
    let renderer: THREE.WebGLRenderer | null = null;
    let scene: THREE.Scene | null = null;
    let camera: THREE.PerspectiveCamera | null = null;

    // Check WebGL availability
    try {
      const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
      if (!gl) {
        setWebGLError(true);
        return;
      }
    } catch {
      setWebGLError(true);
      return;
    }

    // 1. Scene Setup
    scene = new THREE.Scene();

    const width = container.clientWidth || 360;
    const height = container.clientHeight || 640;
    const aspect = width / height;

    // Perspective Camera calibrated for full-body view
    camera = new THREE.PerspectiveCamera(38, aspect, 0.1, 100);
    camera.position.set(0, 0, 4.4);

    try {
      renderer = new THREE.WebGLRenderer({
        canvas,
        alpha: true,
        antialias: true,
        powerPreference: 'high-performance',
      });
      renderer.setSize(width, height);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.08;
    } catch (err) {
      console.warn('WebGL init failed, switching to fallback:', err);
      setWebGLError(true);
      return;
    }

    // 2. Lighting Setup
    const ambientLight = new THREE.AmbientLight(0xffffff, 0.95);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xf5edff, 1.2);
    keyLight.position.set(1.5, 3, 2.5);
    scene.add(keyLight);

    const rimLightLeft = new THREE.PointLight(0xa855f7, 1.8, 8);
    rimLightLeft.position.set(-2, 1, 1);
    scene.add(rimLightLeft);

    const rimLightRight = new THREE.PointLight(0x06b6d4, 1.6, 8);
    rimLightRight.position.set(2, 0.5, 1);
    scene.add(rimLightRight);

    // 3. Avatar Rigging Hierarchy
    const avatarGroup = new THREE.Group();
    scene.add(avatarGroup);

    // Dynamic ground shadow
    const shadowGeo = new THREE.PlaneGeometry(1.6, 0.5);
    const shadowMat = new THREE.MeshBasicMaterial({
      color: 0x000000,
      transparent: true,
      opacity: 0.5,
      blending: THREE.NormalBlending,
    });
    const shadowMesh = new THREE.Mesh(shadowGeo, shadowMat);
    shadowMesh.rotation.x = -Math.PI / 2;
    shadowMesh.position.set(0, -1.95, 0);
    avatarGroup.add(shadowMesh);

    // 4. Character Texture and Body Mesh
    const textureLoader = new THREE.TextureLoader();
    let bodyMesh: THREE.Mesh | null = null;
    let headPivot: THREE.Group = new THREE.Group();
    let eyesMesh: THREE.Mesh | null = null;
    let mouthMesh: THREE.Mesh | null = null;
    let particlesMesh: THREE.Points | null = null;

    // Load full-body texture
    const textureUrl = '/chloe-avatar-fullbody.webp';
    textureLoader.load(
      textureUrl,
      (texture) => {
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.minFilter = THREE.LinearMipmapLinearFilter;
        texture.magFilter = THREE.LinearFilter;

        // Plane aspect ratio matching full-body portrait (~1:1.8)
        const planeWidth = 2.1;
        const planeHeight = 3.85;

        // Subdivided mesh for organic vertex-shader-like breathing deformation
        const geometry = new THREE.PlaneGeometry(planeWidth, planeHeight, 32, 64);

        const material = new THREE.MeshStandardMaterial({
          map: texture,
          transparent: true,
          roughness: 0.55,
          metalness: 0.1,
          alphaTest: 0.05,
        });

        bodyMesh = new THREE.Mesh(geometry, material);
        bodyMesh.position.set(0, 0, 0);
        avatarGroup.add(bodyMesh);

        // Neck & Head Pivot point (around y = 1.05 in local coordinates)
        headPivot = new THREE.Group();
        headPivot.position.set(0, 1.05, 0.01);
        avatarGroup.add(headPivot);

        // 5. Procedural Expressive Eyelids / Blink Mesh
        // Positioned over the eye region (relative to head pivot)
        const eyeCanvas = document.createElement('canvas');
        eyeCanvas.width = 128;
        eyeCanvas.height = 64;
        const eyeCtx = eyeCanvas.getContext('2d')!;
        
        const eyeTexture = new THREE.CanvasTexture(eyeCanvas);
        eyeTexture.colorSpace = THREE.SRGBColorSpace;
        
        const eyeGeo = new THREE.PlaneGeometry(0.35, 0.16);
        const eyeMat = new THREE.MeshBasicMaterial({
          map: eyeTexture,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        });
        eyesMesh = new THREE.Mesh(eyeGeo, eyeMat);
        eyesMesh.position.set(0, 0.15, 0.03); // Eye level on face
        headPivot.add(eyesMesh);

        // 6. Dynamic Lip-Sync Mouth Mesh
        const mouthCanvas = document.createElement('canvas');
        mouthCanvas.width = 128;
        mouthCanvas.height = 64;
        const mouthCtx = mouthCanvas.getContext('2d')!;
        const mouthTexture = new THREE.CanvasTexture(mouthCanvas);
        mouthTexture.colorSpace = THREE.SRGBColorSpace;

        const mouthGeo = new THREE.PlaneGeometry(0.24, 0.14);
        const mouthMat = new THREE.MeshBasicMaterial({
          map: mouthTexture,
          transparent: true,
          opacity: 0,
          depthWrite: false,
        });
        mouthMesh = new THREE.Mesh(mouthGeo, mouthMat);
        mouthMesh.position.set(0, -0.05, 0.03); // Mouth level on face
        headPivot.add(mouthMesh);

        // Helper to draw eyelid skin onto eyeCanvas during blinks
        const drawBlink = (blinkProgress: number) => {
          eyeCtx.clearRect(0, 0, 128, 64);
          if (blinkProgress <= 0.05) {
            eyeMat.opacity = 0;
            return;
          }
          eyeMat.opacity = Math.min(1, blinkProgress * 1.2);
          
          // Natural warm skin tone matching CHLOÉ's eyelid
          eyeCtx.fillStyle = 'rgba(215, 170, 150, 0.95)';
          const closedH = 26 * blinkProgress;
          
          // Left eyelid
          eyeCtx.beginPath();
          eyeCtx.ellipse(38, 30, 20, closedH, 0, 0, Math.PI * 2);
          eyeCtx.fill();
          
          // Subtle eyelash crease line
          eyeCtx.strokeStyle = 'rgba(75, 45, 40, 0.85)';
          eyeCtx.lineWidth = 2.5;
          eyeCtx.beginPath();
          eyeCtx.ellipse(38, 30 + closedH * 0.4, 20, closedH * 0.3, 0, 0, Math.PI);
          eyeCtx.stroke();

          // Right eyelid
          eyeCtx.beginPath();
          eyeCtx.ellipse(90, 30, 20, closedH, 0, 0, Math.PI * 2);
          eyeCtx.fill();
          
          eyeCtx.beginPath();
          eyeCtx.ellipse(90, 30 + closedH * 0.4, 20, closedH * 0.3, 0, 0, Math.PI);
          eyeCtx.stroke();

          eyeTexture.needsUpdate = true;
        };

        // Helper to render dynamic mouth visemes onto mouthCanvas
        const drawMouth = (viseme: VisemeState) => {
          mouthCtx.clearRect(0, 0, 128, 64);
          if (!viseme.isSpeaking && viseme.viseme === 'rest' && stateRef.current !== 'greeting') {
            mouthMat.opacity = 0;
            return;
          }

          mouthMat.opacity = 0.92;
          const open = viseme.openAmount;
          const spread = viseme.widthSpread;
          const isSmile = viseme.viseme === 'smile' || stateRef.current === 'greeting' || stateRef.current === 'happy';

          // Interior mouth cavity
          if (open > 0.15) {
            mouthCtx.fillStyle = 'rgba(90, 25, 30, 0.95)';
            mouthCtx.beginPath();
            mouthCtx.ellipse(64, 32, 16 * spread + 4, 12 * open + 2, 0, 0, Math.PI * 2);
            mouthCtx.fill();

            // Upper teeth hint
            mouthCtx.fillStyle = 'rgba(250, 250, 250, 0.9)';
            mouthCtx.beginPath();
            mouthCtx.rect(64 - 10 * spread, 32 - 10 * open, 20 * spread, 4 * open + 1);
            mouthCtx.fill();
          }

          // Natural rosy lips outline & fill
          mouthCtx.strokeStyle = 'rgba(195, 95, 115, 0.9)';
          mouthCtx.lineWidth = 3;
          mouthCtx.beginPath();
          if (isSmile) {
            mouthCtx.arc(64, 24, 24, 0.2 * Math.PI, 0.8 * Math.PI, false);
          } else {
            mouthCtx.ellipse(64, 32, 18 * spread + 4, 10 * open + 3, 0, 0, Math.PI * 2);
          }
          mouthCtx.stroke();

          mouthTexture.needsUpdate = true;
        };

        // Subscribe to real-time lip-sync engine
        const unsubscribeLipSync = speechLipSync.subscribe((visemeState) => {
          drawMouth(visemeState);
        });

        // Store unsubscription for cleanup
        (scene as any)._unsubscribeLipSync = unsubscribeLipSync;
        (scene as any)._drawBlink = drawBlink;
      },
      undefined,
      (err) => {
        console.error('Failed to load Chloe avatar texture:', err);
        setWebGLError(true);
      }
    );

    // 7. Ambient Particle Constellation (Floating Sparkles)
    const particleCount = 40;
    const particleGeo = new THREE.BufferGeometry();
    const particlePos = new Float32Array(particleCount * 3);
    const particleSpeeds = new Float32Array(particleCount);

    for (let i = 0; i < particleCount; i++) {
      particlePos[i * 3] = (Math.random() - 0.5) * 3;
      particlePos[i * 3 + 1] = (Math.random() - 0.5) * 4;
      particlePos[i * 3 + 2] = (Math.random() - 0.5) * 1.5;
      particleSpeeds[i] = 0.2 + Math.random() * 0.6;
    }

    particleGeo.setAttribute('position', new THREE.BufferAttribute(particlePos, 3));

    const particleMat = new THREE.PointsMaterial({
      color: 0xc4b5fd,
      size: 0.05,
      transparent: true,
      opacity: 0.65,
      blending: THREE.AdditiveBlending,
    });

    particlesMesh = new THREE.Points(particleGeo, particleMat);
    scene.add(particlesMesh);

    // 8. Animation & Physics Variables
    let clock = new THREE.Clock();
    let nextBlinkTime = 2.5;
    let blinkTimer = 0;
    let isBlinking = false;
    let blinkProgress = 0;

    let targetHeadRotX = 0;
    let targetHeadRotY = 0;
    let targetHeadRotZ = 0;
    let currentHeadRotX = 0;
    let currentHeadRotY = 0;
    let currentHeadRotZ = 0;

    let mouseX = 0;
    let mouseY = 0;

    // Pointer move listener for subtle tracking
    const handlePointerMove = (e: MouseEvent | TouchEvent) => {
      const rect = container.getBoundingClientRect();
      const clientX = 'touches' in e ? e.touches[0].clientX : e.clientX;
      const clientY = 'touches' in e ? e.touches[0].clientY : e.clientY;

      mouseX = ((clientX - rect.left) / rect.width) * 2 - 1;
      mouseY = -(((clientY - rect.top) / rect.height) * 2 - 1);
    };

    window.addEventListener('mousemove', handlePointerMove, { passive: true });
    window.addEventListener('touchmove', handlePointerMove, { passive: true });

    // 9. Responsive Resize Handler (Samsung Galaxy S24 framing)
    const handleResize = () => {
      if (!container || !renderer || !camera) return;
      const w = container.clientWidth || 360;
      const h = container.clientHeight || 640;
      camera.aspect = w / h;

      // Ensure full-body silhouette fits perfectly:
      // If screen is narrow (e.g. 19.5:9 on S24), adjust distance
      const vFov = (camera.fov * Math.PI) / 180;
      const desiredHeight = 4.2; // Full character height with safe bounds
      const distance = desiredHeight / (2 * Math.tan(vFov / 2));
      
      // Keep avatar centered vertically with safe space for top bar and bottom dock
      camera.position.z = Math.max(distance, 4.4);
      camera.position.y = isSidePanel ? 0 : 0.05;
      camera.updateProjectionMatrix();

      renderer.setSize(w, h);
    };

    const resizeObserver = new ResizeObserver(() => handleResize());
    resizeObserver.observe(container);
    handleResize();

    // 10. Main Animation Render Loop
    let isVisible = true;
    const handleVisibilityChange = () => {
      isVisible = !document.hidden;
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);

    const animate = () => {
      animationFrameId = requestAnimationFrame(animate);
      if (!isVisible || !renderer || !scene || !camera) return;

      const delta = clock.getDelta();
      const time = clock.getElapsedTime();
      const currentState = stateRef.current;
      const currentPreferences = preferencesRef.current;
      const animated = currentPreferences.animated;

      // 1. Natural Breathing Motion (Sinusoidal vertical & depth expansion)
      if (animated && bodyMesh) {
        const breathSpeed = currentState === 'listening' ? 1.4 : currentState === 'thinking' ? 2.2 : 1.6;
        const breathAmount = currentState === 'thinking' ? 0.022 : 0.016;
        const breathScaleY = 1 + Math.sin(time * breathSpeed) * breathAmount;
        const breathScaleX = 1 + Math.cos(time * breathSpeed * 0.5) * (breathAmount * 0.4);
        
        bodyMesh.scale.set(breathScaleX, breathScaleY, 1);

        // Gentle pelvic / body weight shift sway
        const swayAngle = Math.sin(time * 0.6) * 0.012;
        bodyMesh.rotation.z = swayAngle;

        // Floor shadow reacts to breathing
        shadowMesh.scale.set(1 + swayAngle * 2, 1 + Math.sin(time * breathSpeed) * 0.05, 1);
      }

      // 2. Head Rotation & Posture based on Emotional State & Pointer
      if (animated) {
        let statePitch = 0;
        let stateYaw = 0;
        let stateRoll = 0;

        switch (currentState) {
          case 'listening':
            // Attentive posture: slight forward pitch and side tilt
            statePitch = -0.04;
            stateRoll = 0.035;
            stateYaw = mouseX * 0.08;
            break;
          case 'thinking':
            // Thoughtful posture: slight upward tilt and looking to the side
            statePitch = 0.06;
            stateYaw = 0.08 + Math.sin(time * 0.8) * 0.03;
            stateRoll = -0.025;
            break;
          case 'speaking':
            // Rhythmic micro-nods synchronized with speech cadence
            statePitch = Math.sin(time * 6.5) * 0.035 - 0.02;
            stateYaw = Math.cos(time * 3.2) * 0.025;
            stateRoll = Math.sin(time * 2.1) * 0.015;
            break;
          case 'greeting':
          case 'happy':
            // Warm greeting nod and smile
            statePitch = Math.sin(time * 4) * 0.045 - 0.02;
            stateRoll = 0.02;
            stateYaw = mouseX * 0.05;
            break;
          case 'idle':
          default:
            // Natural idle head drift
            statePitch = Math.sin(time * 0.9) * 0.018;
            stateYaw = Math.cos(time * 0.7) * 0.022 + mouseX * 0.06;
            stateRoll = Math.sin(time * 0.5) * 0.01;
            break;
        }

        targetHeadRotX = statePitch;
        targetHeadRotY = stateYaw;
        targetHeadRotZ = stateRoll;

        // Smooth damping interpolation (spring)
        currentHeadRotX += (targetHeadRotX - currentHeadRotX) * 0.08;
        currentHeadRotY += (targetHeadRotY - currentHeadRotY) * 0.08;
        currentHeadRotZ += (targetHeadRotZ - currentHeadRotZ) * 0.08;

        headPivot.rotation.x = currentHeadRotX;
        headPivot.rotation.y = currentHeadRotY;
        headPivot.rotation.z = currentHeadRotZ;
      }

      // 3. Eye Blinking System (Natural Poisson interval + cubic ease)
      if (animated) {
        blinkTimer += delta;
        if (!isBlinking && blinkTimer > nextBlinkTime) {
          isBlinking = true;
          blinkTimer = 0;
          // Randomize next blink between 2.6 and 4.8 seconds
          nextBlinkTime = 2.6 + Math.random() * 2.2;
        }

        if (isBlinking) {
          const blinkDuration = 0.16; // 160ms blink cycle
          const progress = blinkTimer / blinkDuration;

          if (progress <= 0.4) {
            // Rapid eye closure
            blinkProgress = progress / 0.4;
          } else if (progress <= 1.0) {
            // Smooth opening
            blinkProgress = 1 - (progress - 0.4) / 0.6;
          } else {
            blinkProgress = 0;
            isBlinking = false;
          }

          if ((scene as any)._drawBlink) {
            (scene as any)._drawBlink(blinkProgress);
          }
        }
      }

      // 4. Dynamic Lighting Modulation by State
      switch (currentState) {
        case 'listening':
          rimLightRight.color.setHex(0x06b6d4); // Cyan
          rimLightRight.intensity = 2.4;
          rimLightLeft.color.setHex(0x3b82f6); // Blue
          break;
        case 'thinking':
          rimLightRight.color.setHex(0xa855f7); // Purple
          rimLightRight.intensity = 2.2 + Math.sin(time * 3) * 0.6;
          rimLightLeft.color.setHex(0x6366f1); // Indigo
          break;
        case 'speaking':
          rimLightRight.color.setHex(0xec4899); // Fuchsia
          rimLightRight.intensity = 2.3 + Math.sin(time * 7) * 0.5;
          rimLightLeft.color.setHex(0x9333ea); // Violet
          break;
        case 'greeting':
        case 'happy':
          rimLightRight.color.setHex(0xf59e0b); // Gold
          rimLightRight.intensity = 2.5;
          rimLightLeft.color.setHex(0x10b981); // Emerald
          break;
        case 'idle':
        default:
          rimLightRight.color.setHex(0x8b5cf6);
          rimLightRight.intensity = 1.4;
          rimLightLeft.color.setHex(0x6366f1);
          break;
      }

      // 5. Orbiting Ambient Particles
      if (particlesMesh && currentPreferences.ambientParticles) {
        const positions = particleGeo.attributes.position.array as Float32Array;
        for (let i = 0; i < particleCount; i++) {
          positions[i * 3 + 1] += particleSpeeds[i] * delta * 0.35;
          // Wrap around top/bottom
          if (positions[i * 3 + 1] > 2.5) {
            positions[i * 3 + 1] = -2.2;
          }
        }
        particleGeo.attributes.position.needsUpdate = true;
        particlesMesh.rotation.y = time * 0.08;
      }

      renderer.render(scene, camera);
    };

    animate();

    // 11. Cleanup
    return () => {
      cancelAnimationFrame(animationFrameId);
      window.removeEventListener('mousemove', handlePointerMove);
      window.removeEventListener('touchmove', handlePointerMove);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
      resizeObserver.disconnect();

      if ((scene as any)._unsubscribeLipSync) {
        (scene as any)._unsubscribeLipSync();
      }

      // Dispose Three.js objects
      if (renderer) {
        renderer.dispose();
      }
      scene?.traverse((obj) => {
        if (obj instanceof THREE.Mesh) {
          obj.geometry.dispose();
          if (Array.isArray(obj.material)) {
            obj.material.forEach((m) => m.dispose());
          } else {
            obj.material.dispose();
          }
        }
      });
    };
  }, [isSidePanel]);

  // Touch and Click Interaction (Samsung S24 Raycast & Haptic feedback)
  const handleInteraction = useCallback(() => {
    // Android Samsung haptic vibration
    if (typeof navigator !== 'undefined' && 'vibrate' in navigator) {
      try {
        navigator.vibrate([18, 25]);
      } catch {}
    }

    // Trigger visual greeting feedback
    const quotes = [
      "Bonjour ! Je suis là avec vous.",
      "Comment puis-je vous aider aujourd'hui ?",
      "Je vous écoute !",
      "Prête pour vos instructions !",
    ];
    const quote = quotes[Math.floor(Math.random() * quotes.length)];
    setInteractiveFeedback(quote);

    setTimeout(() => {
      setInteractiveFeedback(null);
    }, 3200);

    if (onTap) {
      onTap();
    }
  }, [onTap]);

  // If WebGL fails, gracefully render the high-res character fallback
  if (webGLError) {
    return (
      <div
        onClick={handleInteraction}
        className={`relative flex items-center justify-center select-none cursor-pointer ${className}`}
      >
        <img
          src="/chloe-avatar-fullbody.webp"
          alt="CHLOÉ AI — Présence virtuelle"
          className="h-full w-auto max-h-[85vh] object-contain drop-shadow-[0_15px_30px_rgba(0,0,0,0.85)] filter"
          onError={(e) => {
            const target = e.currentTarget;
            if (!target.src.includes('chloe-avatar-fullbody_f3fa7d52.webp')) {
              target.src = '/assets/aistudio/chloe-avatar-fullbody_f3fa7d52.webp';
            }
          }}
        />
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      onClick={handleInteraction}
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      className={`relative w-full h-full flex items-center justify-center select-none cursor-pointer overflow-hidden ${className}`}
      style={{ touchAction: 'pan-y' }}
    >
      <canvas
        ref={canvasRef}
        className="w-full h-full block focus:outline-none"
        style={{
          filter: state === 'speaking' ? 'drop-shadow(0 0 25px rgba(236,72,153,0.35))' : 'drop-shadow(0 0 20px rgba(168,85,247,0.25))',
          transition: 'filter 0.5s ease',
        }}
      />

      {/* Interactive Speech / Greeting Bubble on Touch */}
      {interactiveFeedback && (
        <div className="absolute top-12 sm:top-16 z-30 px-4 py-2.5 rounded-2xl bg-[#121630]/95 border border-purple-500/50 text-white text-xs shadow-2xl backdrop-blur-md animate-in fade-in zoom-in-95 duration-300 max-w-[260px] text-center pointer-events-none">
          <p className="font-semibold text-purple-200">{interactiveFeedback}</p>
          <div className="absolute -bottom-1.5 left-1/2 -translate-x-1/2 w-3 h-3 bg-[#121630] border-r border-b border-purple-500/50 rotate-45" />
        </div>
      )}

      {/* Subtle touch hint when hovered */}
      {isHovered && !interactiveFeedback && (
        <div className="absolute bottom-4 z-20 px-3 py-1 rounded-full bg-black/60 border border-purple-500/30 text-[10px] text-purple-300 backdrop-blur-sm pointer-events-none animate-in fade-in">
          Touchez CHLOÉ pour interagir
        </div>
      )}
    </div>
  );
};
