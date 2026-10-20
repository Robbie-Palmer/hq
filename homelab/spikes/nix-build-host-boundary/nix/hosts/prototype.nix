{
  pepPythonService,
  ...
}:
{
  imports = [ ../modules/pep-health.nix ];

  boot.isContainer = true;
  networking.hostName = "pep-nix-spike";

  services.pep-health = {
    enable = true;
    package = pepPythonService;
    listenAddress = "127.0.0.1";
    port = 8081;
  };

  system.stateVersion = "25.11";
}
