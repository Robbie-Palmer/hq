{
  fetchurl,
  kernel,
  lib,
  stdenv,
}:

let
  version = "0.13-unstable-2026-10-28";
  revision = "d7fbbd88e6831e56801b860e46475cbf8ddbc7c1";
in
stdenv.mkDerivation {
  pname = "msi-ec";
  inherit version;

  src = fetchurl {
    url = "https://github.com/BeardOverflow/msi-ec/archive/${revision}.tar.gz";
    hash = "sha256-7zOWpMhw90o8IbZiP6bjHaFWnIjZIXGnuYf4vLPBgnk=";
  };

  nativeBuildInputs = kernel.moduleBuildDependencies;

  buildPhase = ''
    runHook preBuild
    make -C ${kernel.dev}/lib/modules/${kernel.modDirVersion}/build \
      M="$PWD" \
      modules
    runHook postBuild
  '';

  installPhase = ''
    runHook preInstall
    install -Dm0444 msi-ec.ko \
      "$out/lib/modules/${kernel.modDirVersion}/extra/msi-ec.ko"
    runHook postInstall
  '';

  meta = {
    description = "Embedded-controller driver for supported MSI laptops";
    homepage = "https://github.com/BeardOverflow/msi-ec";
    license = lib.licenses.gpl2Plus;
    platforms = lib.platforms.linux;
  };
}
