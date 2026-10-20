{
  config,
  lib,
  ...
}:
let
  cfg = config.services.pep-health;
in
{
  options.services.pep-health = {
    enable = lib.mkEnableOption "the prototype Python health service";

    package = lib.mkOption {
      type = lib.types.package;
      description = "Package containing the pep-python-service executable.";
    };

    listenAddress = lib.mkOption {
      type = lib.types.str;
      default = "127.0.0.1";
      description = "Non-secret address on which the service listens.";
    };

    port = lib.mkOption {
      type = lib.types.port;
      default = 8081;
      description = "Non-secret TCP port on which the service listens.";
    };
  };

  config = lib.mkIf cfg.enable {
    systemd.services.pep-health = {
      description = "Personal Engineering Platform health prototype";
      wantedBy = [ "multi-user.target" ];
      after = [ "network.target" ];
      environment = {
        HOST = cfg.listenAddress;
        PORT = toString cfg.port;
      };
      serviceConfig = {
        DynamicUser = true;
        ExecStart = "${cfg.package}/bin/pep-python-service";
        LockPersonality = true;
        MemoryDenyWriteExecute = true;
        NoNewPrivileges = true;
        PrivateDevices = true;
        PrivateTmp = true;
        ProtectClock = true;
        ProtectHome = true;
        ProtectKernelLogs = true;
        ProtectKernelModules = true;
        ProtectKernelTunables = true;
        ProtectSystem = "strict";
        Restart = "on-failure";
        RestrictAddressFamilies = [
          "AF_INET"
          "AF_INET6"
        ];
        RestrictNamespaces = true;
        RestrictRealtime = true;
        SystemCallArchitectures = "native";
      };
    };
  };
}
