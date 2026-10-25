{
  appimageTools,
  fetchurl,
  lib,
}:

let
  pname = "t3-code";
  version = "0.1.2";
  src = fetchurl {
    url = "https://github.com/pingdotgg/t3code/releases/download/v${version}/T3-Code-${version}-x86_64.AppImage";
    hash = "sha256-zwHi0Wfv+dAcTBAE0xssDaniUizJQmLkFkTRyxXf21w=";
  };
  contents = appimageTools.extractType2 { inherit pname version src; };
in
appimageTools.wrapType2 {
  inherit pname version src;

  extraInstallCommands = ''
    test -x $out/bin/t3-code
    install -Dm444 ${contents}/t3code.desktop $out/share/applications/t3code.desktop
    install -Dm444 ${contents}/t3code.png $out/share/pixmaps/t3code.png
    substituteInPlace $out/share/applications/t3code.desktop \
      --replace-fail 'Exec=AppRun %U' 'Exec=t3-code %U'
  '';

  meta = {
    description = "Desktop client for T3 Code";
    homepage = "https://t3.codes/";
    license = lib.licenses.mit;
    mainProgram = "t3-code";
    platforms = [ "x86_64-linux" ];
  };
}
