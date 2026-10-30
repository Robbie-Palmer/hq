export function smoothScrollTo(
  elementId: string,
  options: { offset?: number; duration?: number } = {},
): { promise: Promise<void>; cancel: () => void } {
  let cancel = () => {};

  const promise = new Promise<void>((resolve) => {
    const { offset = 0, duration = 1000 } = options;
    const element = document.getElementById(elementId);
    if (!element) {
      resolve();
      return;
    }

    const startY = window.scrollY;
    const startX = window.scrollX;
    const elementPosition = element.getBoundingClientRect().top;
    const targetPosition = elementPosition + startY - offset;
    const distance = targetPosition - startY;
    let startTime: number | null = null;
    let animationFrameId: number;

    cancel = () => {
      cancelAnimationFrame(animationFrameId);
      resolve();
    };

    function animation(currentTime: number) {
      if (startTime === null) startTime = currentTime;
      const timeElapsed = currentTime - startTime;
      const run = easeInOutQuad(timeElapsed, startY, distance, duration);
      window.scrollTo(startX, run);

      if (timeElapsed < duration) {
        animationFrameId = requestAnimationFrame(animation);
      } else {
        resolve();
      }
    }

    function easeInOutQuad(t: number, b: number, c: number, d: number) {
      t /= d / 2;
      if (t < 1) return (c / 2) * t * t + b;
      t--;
      return (-c / 2) * (t * (t - 2) - 1) + b;
    }

    animationFrameId = requestAnimationFrame(animation);
  });

  return { promise, cancel };
}
