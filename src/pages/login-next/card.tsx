import React, { createContext, useEffect, useRef, useState } from 'react';
import './index.less';

export const FlipFaceContext = createContext<'front' | 'back'>('front');

/** 与 index.less 的 transition-duration 对齐；动画结束后只保留活动面内容。 */
const FLIP_ANIMATION_MS = 450;

type IProps = {
  children: React.ReactNode;
  isLoginPage: boolean;
};

const FlipCard3D = (props: IProps) => {
  const { children, isLoginPage } = props;
  const [isFlipped, setIsFlipped] = useState(!isLoginPage);
  // 翻转动画窗口内两面都渲染内容，保证视觉连续；窗口结束后只保留活动面，
  // 避免同一表单/按钮在 DOM、Tab 焦点与无障碍树中出现两份（B2 修复）。
  const [isAnimating, setIsAnimating] = useState(false);
  const flippedRef = useRef(!isLoginPage);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const frontRef = useRef<HTMLDivElement>(null);
  const backRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // During the flip window both faces hold the same form.  aria-hidden
    // does not remove focusability, so mark the inactive face inert as well.
    const setInert = (el: HTMLDivElement | null, inert: boolean) => {
      if (el) {
        (el as HTMLDivElement & { inert: boolean }).inert = inert;
      }
    };
    setInert(frontRef.current, isFlipped);
    setInert(backRef.current, !isFlipped);
  }, [isFlipped]);

  useEffect(() => {
    if (flippedRef.current === !isLoginPage) {
      return;
    }
    flippedRef.current = !isLoginPage;
    setIsFlipped(!isLoginPage);
    setIsAnimating(true);
    if (timerRef.current) {
      clearTimeout(timerRef.current);
    }
    timerRef.current = setTimeout(() => {
      setIsAnimating(false);
    }, FLIP_ANIMATION_MS);
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, [isLoginPage]);

  const isBackfaceVisibilitySupported = () => {
    return (
      CSS.supports('backface-visibility', 'hidden') ||
      CSS.supports('-webkit-backface-visibility', 'hidden') ||
      CSS.supports('-moz-backface-visibility', 'hidden') ||
      CSS.supports('-ms-backface-visibility', 'hidden')
    );
  };
  return (
    <>
      {isBackfaceVisibilitySupported() && (
        <div className="relative w-full h-full perspective-1000">
          <div
            className={`relative w-full h-full transition-transform transform-style-3d ${isFlipped ? 'rotate-y-180' : ''}`}
          >
            {/* Front Face */}
            <div
              ref={frontRef}
              className={`absolute inset-0 flex items-center justify-center backface-hidden rotate-y-0 ${isFlipped ? 'pointer-events-none' : ''}`}
              {...(!isFlipped ? { 'data-testid': 'auth-card-active' } : { 'aria-hidden': true })}
            >
              <FlipFaceContext.Provider value="front">
                {(!isFlipped || isAnimating) && children}
              </FlipFaceContext.Provider>
            </div>

            {/* Back Face */}
            <div
              ref={backRef}
              className={`absolute inset-0 flex items-center justify-center backface-hidden rotate-y-180 ${isFlipped ? '' : 'pointer-events-none'}`}
              {...(isFlipped ? { 'data-testid': 'auth-card-active' } : { 'aria-hidden': true })}
            >
              <FlipFaceContext.Provider value="back">
                {(isFlipped || isAnimating) && children}
              </FlipFaceContext.Provider>
            </div>
          </div>
        </div>
      )}
      {!isBackfaceVisibilitySupported() && (
        <div data-testid="auth-card-active">
          <FlipFaceContext.Provider value={isFlipped ? 'back' : 'front'}>
            {children}
          </FlipFaceContext.Provider>
        </div>
      )}
    </>
  );
};

export default FlipCard3D;
