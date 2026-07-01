import loadingGif from "@/assets/intima-loading.gif";

export const LoadingScreen = (_: { label?: string }) => (
  <div className="fixed inset-0 flex items-center justify-center bg-background z-50">
    <img
      src={loadingGif}
      alt="Loading"
      className="w-96 h-96 object-contain"
      draggable={false}
    />
  </div>
);

export default LoadingScreen;
