{
  config,
  lib,
  pkgs,
  ...
}:

let
  dataMount = "/srv/vector-development";
  operatorDataPath = "${dataMount}/t3-code";
  cacheDataPath = "${dataMount}/t3-code-cache";
  operatorProjectId = "3000";
  cacheProjectId = "3001";
  operatorBlockHardLimit = "500G";
  operatorBlockHardLimitKiB = "524288000";
  operatorInodeHardLimit = "8000000";
  cacheBlockHardLimit = "250G";
  cacheBlockHardLimitKiB = "262144000";
  cacheInodeHardLimit = "5000000";
  projectQuotaLayoutVersion = "1";
  operatorKeys = [
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIM10tppAS+3nlXzecNqk+YUuzwN2KtT5//gwoUqhDt36 robbiepalmer@live.co.uk"
    "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIIj4+tNshoonWcOZFnSV0YcXgKuGqfcmn5HyIvLCfdQe robbiepalmer@live.co.uk"
  ];
  initrdUnlockKeys = map (key: ''restrict,command="/bin/vector-remote-unlock" ${key}'') operatorKeys;
  initrdHostKey = "/etc/secrets/initrd/vector-development_ssh_host_ed25519_key";
  remoteUnlockScript = pkgs.writeShellScript "vector-remote-unlock" (
    builtins.readFile ./scripts/vector-remote-unlock.bash
  );
  t3CodeDesktop = pkgs.callPackage ../../packages/t3-code-desktop.nix { };
  msiEc = config.boot.kernelPackages.callPackage ../../packages/msi-ec.nix { };
  nvidiaContainerTools = lib.getOutput "tools" config.hardware.nvidia-container-toolkit.package;
  tomlFormat = pkgs.formats.toml { };
  nvidiaContainerConfig = tomlFormat.generate "nvidia-container-runtime-config.toml" {
    "disable-require" = true;
    "supported-driver-capabilities" = "compat32,compute,display,graphics,ngx,utility,video";
    "nvidia-container-cli" = {
      environment = [ ];
      ldconfig = "@${lib.getExe' pkgs.glibc "ldconfig"}";
      "load-kmods" = true;
      "no-cgroups" = false;
      path = lib.getExe' pkgs.libnvidia-container "nvidia-container-cli";
    };
    "nvidia-container-runtime" = {
      mode = "cdi";
      runtimes = [ (lib.getExe pkgs.runc) ];
    };
    "nvidia-container-runtime-hook" = {
      path = "${nvidiaContainerTools}/bin/nvidia-container-runtime-hook";
      "skip-mode-detection" = false;
    };
    "nvidia-ctk".path = lib.getExe' config.hardware.nvidia-container-toolkit.package "nvidia-ctk";
  };
  dataLayoutScript = pkgs.writeShellApplication {
    name = "vector-development-data-layout";
    runtimeInputs = [ pkgs.coreutils ];
    text = builtins.readFile ./scripts/create-data-layout.bash;
  };
  projectQuotaScript = pkgs.writeShellApplication {
    name = "vector-development-project-quotas";
    runtimeInputs = with pkgs; [
      coreutils
      e2fsprogs
      findutils
      gawk
      gnugrep
      quota
      util-linux
    ];
    text = builtins.readFile ./scripts/apply-project-quotas.bash;
  };
  tailscaleServeScript = pkgs.writeShellApplication {
    name = "vector-development-tailscale-serve";
    runtimeInputs = with pkgs; [
      jq
      tailscale
    ];
    text = builtins.readFile ./scripts/configure-tailscale-serve.bash;
  };
  quietProfileScript = pkgs.writeShellApplication {
    name = "vector-development-quiet-profile";
    runtimeInputs = with pkgs; [
      coreutils
      gnugrep
    ];
    text = builtins.readFile ./scripts/apply-quiet-profile.bash;
  };
  fanCurveScript = pkgs.writeShellApplication {
    name = "vector-development-fan-curve";
    runtimeInputs = with pkgs; [
      coreutils
      gnugrep
      kmod
      util-linux
    ];
    text = builtins.readFile ./scripts/apply-fan-curve.bash;
  };
  thermalMonitor = pkgs.writeShellApplication {
    name = "vector-development-thermal-monitor";
    runtimeInputs = with pkgs; [
      coreutils
      gawk
      gnugrep
      jq
      procps
    ];
    text = builtins.readFile ./scripts/thermal-monitor.bash;
  };
  gpuJobLauncher = pkgs.writeShellApplication {
    name = "vector-gpu-benchmark";
    runtimeInputs = with pkgs; [
      jq
      kubectl
    ];
    text = builtins.readFile ../../scripts/vector-gpu-benchmark.sh;
  };
  gpuHealthCollector = pkgs.writeShellApplication {
    name = "vector-development-gpu-health";
    runtimeInputs = with pkgs; [
      curl
      gawk
      gnugrep
      jq
      k3s
    ];
    text = builtins.readFile ./scripts/collect-gpu-health.bash;
  };
in
{
  imports = [
    ./disk-config.nix
    ./hardware-configuration.nix
  ];

  homelab.hostLifecycle = {
    enable = true;
    profile = "hardware";
    hostName = "vector-development";
    stateVersion = "26.05";
    operator = {
      authorizedKeys = operatorKeys;
      extraGroups = [
        "docker"
        "networkmanager"
        "video"
        "wheel"
      ];
      mutablePassword = true;
      wheelNeedsPassword = true;
    };
    k3s = {
      nodeLabels = [
        "homelab.dev/location=home"
        "homelab.dev/capability=agent-workspace"
        "homelab.dev/power-profile=mains-dependent"
        "homelab.dev/accelerator=nvidia"
      ];
      extraFlags = [
        "--kubelet-arg=node-ip=0.0.0.0"
        "--kube-proxy-arg=nodeport-addresses=127.0.0.0/8"
      ];
      extraKubeletConfig.systemReserved = {
        cpu = "2";
        memory = "4Gi";
      };
    };
    requiredMounts = [ "/" ];
    secretBootstrapPaths = [ initrdHostKey ];
  };

  networking = {
    networkmanager = {
      enable = true;
      # NetworkManager.conf requires the numeric NMSettingWiredWakeOnLan flag.
      settings = {
        connection."ethernet.wake-on-lan" = 64;
        main.no-auto-default = "*";
      };
      ensureProfiles.profiles.vector-development-wired = {
        connection = {
          id = "vector-development-wired";
          type = "ethernet";
          interface-name = "enp58s0";
          autoconnect = true;
          autoconnect-priority = 100;
          down-on-poweroff = 0;
        };
        "802-3-ethernet"."wake-on-lan" = 64;
        ipv4.method = "auto";
        ipv6.method = "auto";
      };
    };
    interfaces.enp58s0.wakeOnLan = {
      enable = true;
      policy = [ "magic" ];
    };
  };

  boot = {
    extraModulePackages = [ msiEc ];
    kernelModules = [ "msi_ec" ];
    initrd = {
      network.ssh = {
        enable = true;
        port = 2222;
        hostKeys = [ initrdHostKey ];
        authorizedKeys = initrdUnlockKeys;
        extraConfig = ''
          AllowAgentForwarding no
          AllowTcpForwarding no
          GatewayPorts no
          PermitRootLogin prohibit-password
          PermitTTY no
          PermitTunnel no
          X11Forwarding no
        '';
      };
      systemd = {
        extraBin = {
          systemd-reply-password = "${pkgs.systemd}/lib/systemd/systemd-reply-password";
          vector-remote-unlock = remoteUnlockScript;
        };
        network = {
          enable = true;
          networks."10-vector-development-wired" = {
            matchConfig.Name = "enp58s0";
            networkConfig.DHCP = "ipv4";
            dhcpV4Config.ClientIdentifier = "mac";
          };
        };
      };
    };
    loader.systemd-boot.enable = true;
    loader.efi.canTouchEfiVariables = true;
  };

  nixpkgs.config.allowUnfree = true;

  hardware = {
    bluetooth = {
      enable = true;
      powerOnBoot = true;
    };
    graphics.enable = true;
    nvidia = {
      modesetting.enable = true;
      open = true;
      package = config.boot.kernelPackages.nvidiaPackages.stable;
      powerManagement = {
        enable = true;
        finegrained = true;
      };
      prime = {
        intelBusId = "PCI:0@0:2:0";
        nvidiaBusId = "PCI:1@0:0:0";
        offload = {
          enable = true;
          enableOffloadCmd = true;
        };
      };
      nvidiaSettings = true;
      nvidiaPersistenced = false;
    };
    nvidia-container-toolkit.enable = true;
  };

  services = {
    displayManager.gdm = {
      enable = true;
      autoSuspend = false;
    };
    desktopManager.gnome.enable = true;
    xserver = {
      enable = true;
      videoDrivers = [
        "modesetting"
        "nvidia"
      ];
      xkb.layout = "gb";
    };
    libinput.enable = true;
    printing = {
      enable = true;
      clientConf = ''
        ServerName raspberrypi.tailaa0e46.ts.net
      '';
    };
    fwupd.enable = true;
    power-profiles-daemon.enable = true;
    pipewire = {
      enable = true;
      alsa.enable = true;
      alsa.support32Bit = true;
      pulse.enable = true;
    };
    netdata = {
      enable = true;
      enableAnalyticsReporting = false;
      config = {
        global.hostname = "vector-development";
        db = {
          mode = "dbengine";
          retention = "7d";
        };
        web = {
          "bind to" = "tcp:127.0.0.1:19999";
          "allow connections from" = "localhost";
          "allow dashboard from" = "localhost";
        };
        cloud.enabled = "no";
        statsd = {
          "enabled" = "yes";
          "bind to" = "udp:127.0.0.1:8125";
          "create private charts for metrics matching" = "!vector_development.* *";
        };
        plugins = {
          "go.d" = "yes";
          "proc" = "yes";
        };
      };
      configDir = {
        "health.d/vector-development-gpu.conf" = ./netdata/health.d/vector-development-gpu.conf;
        "statsd.d/vector-development.conf" = ./netdata/statsd.d/vector-development.conf;
      };
    };
    logind.settings.Login = {
      HandleLidSwitch = "suspend";
      HandleLidSwitchExternalPower = "ignore";
      HandleLidSwitchDocked = "ignore";
      IdleAction = "ignore";
    };
    journald.extraConfig = ''
      SystemMaxUse=1G
      RuntimeMaxUse=256M
      MaxRetentionSec=14day
      Compress=yes
    '';
  };

  security = {
    apparmor = {
      enable = true;
      includes."tunables/global" = ''
        include "${pkgs.apparmor-profiles}/etc/apparmor.d/tunables/global"
      '';
      packages = [ pkgs.apparmor-profiles ];
      policies."t3-code-agent-browser".profile = ''
        abi <abi/4.0>,

        profile t3-code-agent-browser flags=(unconfined) {
          userns,
        }
      '';
    };
    rtkit.enable = true;
  };

  users = {
    groups.t3code.gid = 2000;
    users.t3code = {
      isSystemUser = true;
      uid = 2000;
      group = "t3code";
      home = "${operatorDataPath}/home";
      createHome = false;
    };
  };

  virtualisation.docker = {
    enable = true;
    package = pkgs.docker_29;
  };

  zramSwap = {
    enable = true;
    algorithm = "zstd";
    memoryPercent = 25;
    priority = 100;
  };

  environment = {
    etc = {
      "nvidia-container-runtime/config.toml".source = nvidiaContainerConfig;
      "opentelemetry-collector/config.yaml".source = ./opentelemetry-collector.yaml;
      projects.text = ''
        ${operatorProjectId}:${operatorDataPath}
        ${cacheProjectId}:${cacheDataPath}
      '';
      projid.text = ''
        t3-code-operator:${operatorProjectId}
        t3-code-cache:${cacheProjectId}
      '';
    };
    systemPackages = with pkgs; [
      brave
      curl
      e2fsprogs
      ethtool
      fanCurveScript
      git
      gh
      gpuJobLauncher
      htop
      jq
      k3s
      kubectl
      kustomize
      less
      libva-utils
      lsof
      pciutils
      quota
      ripgrep
      rsync
      t3CodeDesktop
      tmux
      tree
      usbutils
      vulkan-tools
    ];
  };

  programs.appimage = {
    enable = true;
    binfmt = true;
  };

  programs.dconf.profiles.user.databases = [
    {
      settings."org/gnome/settings-daemon/plugins/power" = {
        sleep-inactive-ac-timeout = lib.gvariant.mkInt32 0;
        sleep-inactive-ac-type = "nothing";
        sleep-inactive-battery-timeout = lib.gvariant.mkInt32 0;
        sleep-inactive-battery-type = "nothing";
      };
      locks = [
        "/org/gnome/settings-daemon/plugins/power/sleep-inactive-ac-timeout"
        "/org/gnome/settings-daemon/plugins/power/sleep-inactive-ac-type"
        "/org/gnome/settings-daemon/plugins/power/sleep-inactive-battery-timeout"
        "/org/gnome/settings-daemon/plugins/power/sleep-inactive-battery-type"
      ];
    }
  ];

  powerManagement.resumeCommands = ''
    ${fanCurveScript}/bin/vector-development-fan-curve apply
  '';

  system.activationScripts.vectorDevelopmentRefreshGnomePower =
    lib.stringAfter
      [
        "etc"
        "users"
      ]
      ''
        if ${pkgs.systemd}/bin/systemctl --quiet is-active user@1000.service \
          && test -S /run/user/1000/bus; then
          ${pkgs.util-linux}/bin/runuser -u robbie -- \
            ${pkgs.coreutils}/bin/env \
              XDG_RUNTIME_DIR=/run/user/1000 \
              DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus \
              ${pkgs.systemd}/bin/systemctl --user restart \
                org.gnome.SettingsDaemon.Power.target || true
        fi
      '';

  systemd.services.vector-development-data-layout = {
    description = "Create vector-development data directories";
    wantedBy = [ "multi-user.target" ];
    before = [ "k3s.service" ];
    serviceConfig = {
      ExecStart = "${dataLayoutScript}/bin/vector-development-data-layout";
      Type = "oneshot";
      RemainAfterExit = true;
    };
    environment = {
      VECTOR_DATA_MOUNT = dataMount;
      VECTOR_OPERATOR_DATA_PATH = operatorDataPath;
      VECTOR_CACHE_DATA_PATH = cacheDataPath;
    };
  };

  systemd.services.vector-development-project-quotas = {
    description = "Apply vector-development project quotas";
    after = [ "vector-development-data-layout.service" ];
    requires = [ "vector-development-data-layout.service" ];
    before = [ "k3s.service" ];
    wantedBy = [ "multi-user.target" ];
    serviceConfig = {
      ExecStart = "${projectQuotaScript}/bin/vector-development-project-quotas";
      Type = "oneshot";
      RemainAfterExit = true;
      StateDirectory = "vector-development";
      StateDirectoryMode = "0700";
    };
    environment = {
      VECTOR_PROJECT_QUOTA_LAYOUT_VERSION = projectQuotaLayoutVersion;
      VECTOR_OPERATOR_DATA_PATH = operatorDataPath;
      VECTOR_OPERATOR_PROJECT_ID = operatorProjectId;
      VECTOR_OPERATOR_BLOCK_HARD_LIMIT = operatorBlockHardLimit;
      VECTOR_OPERATOR_BLOCK_HARD_LIMIT_KIB = operatorBlockHardLimitKiB;
      VECTOR_OPERATOR_INODE_HARD_LIMIT = operatorInodeHardLimit;
      VECTOR_CACHE_DATA_PATH = cacheDataPath;
      VECTOR_CACHE_PROJECT_ID = cacheProjectId;
      VECTOR_CACHE_BLOCK_HARD_LIMIT = cacheBlockHardLimit;
      VECTOR_CACHE_BLOCK_HARD_LIMIT_KIB = cacheBlockHardLimitKiB;
      VECTOR_CACHE_INODE_HARD_LIMIT = cacheInodeHardLimit;
    };
  };

  systemd.services.vector-development-power-profile = {
    description = "Select the power-saver profile";
    after = [ "power-profiles-daemon.service" ];
    requires = [ "power-profiles-daemon.service" ];
    wantedBy = [ "multi-user.target" ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
    };
    script = ''
      ${pkgs.power-profiles-daemon}/bin/powerprofilesctl set power-saver
      test "$(${pkgs.power-profiles-daemon}/bin/powerprofilesctl get)" = power-saver
    '';
  };

  systemd.services.vector-development-quiet-profile = {
    description = "Select the MSI firmware quiet profile";
    after = [ "systemd-modules-load.service" ];
    wantedBy = [ "multi-user.target" ];
    serviceConfig = {
      ExecStart = "${quietProfileScript}/bin/vector-development-quiet-profile";
      Type = "oneshot";
      RemainAfterExit = true;
    };
  };

  systemd.services.vector-development-fan-curve = {
    description = "Apply the Vector zero-RPM idle fan curve";
    after = [ "vector-development-quiet-profile.service" ];
    requires = [ "vector-development-quiet-profile.service" ];
    wantedBy = [ "multi-user.target" ];
    serviceConfig = {
      ExecStart = "${fanCurveScript}/bin/vector-development-fan-curve apply";
      ExecStop = "${fanCurveScript}/bin/vector-development-fan-curve restore";
      RemainAfterExit = true;
      TimeoutSec = "15s";
      Type = "oneshot";
    };
  };

  systemd.services.vector-development-thermal-monitor = {
    description = "Record fan, temperature, and busy-process evidence";
    after = [ "vector-development-fan-curve.service" ];
    requires = [ "vector-development-fan-curve.service" ];
    wantedBy = [ "multi-user.target" ];
    serviceConfig = {
      CapabilityBoundingSet = "";
      CPUWeight = 1;
      ExecStart = "${thermalMonitor}/bin/vector-development-thermal-monitor";
      IOWeight = 1;
      Nice = 19;
      NoNewPrivileges = true;
      PrivateTmp = true;
      ProtectControlGroups = true;
      ProtectHome = "read-only";
      ProtectKernelModules = true;
      ProtectKernelTunables = true;
      ProtectSystem = "strict";
      Restart = "always";
      RestartSec = "5s";
      StateDirectory = "vector-development-thermal-monitor";
      StateDirectoryMode = "0755";
    };
  };

  # containerd probes this fixed FHS path, then invokes the parser through PATH.
  systemd.tmpfiles.rules = [
    "d /sbin 0755 root root - -"
    "L+ /sbin/apparmor_parser - - - - ${pkgs.apparmor-parser}/bin/apparmor_parser"
  ];

  systemd.services.k3s = {
    after = [
      "apparmor.service"
      "nvidia-container-toolkit-cdi-generator.service"
      "vector-development-data-layout.service"
      "vector-development-project-quotas.service"
    ];
    wants = [ "nvidia-container-toolkit-cdi-generator.service" ];
    requires = [
      "apparmor.service"
      "vector-development-data-layout.service"
      "vector-development-project-quotas.service"
    ];
    path = [
      nvidiaContainerTools
      pkgs.apparmor-parser
      pkgs.runc
    ];
  };

  systemd.services.netdata.serviceConfig = {
    MemoryHigh = "320M";
    MemoryMax = "384M";
  };

  systemd.services.vector-development-dcgm-proxy = {
    description = "Expose DCGM Exporter metrics to the host collector through the K3s API";
    after = [ "k3s.service" ];
    requires = [ "k3s.service" ];
    wantedBy = [ "multi-user.target" ];
    serviceConfig = {
      ExecStart = ''
        ${pkgs.k3s}/bin/k3s kubectl \
          --kubeconfig=/etc/rancher/k3s/k3s.yaml \
          proxy \
          --address=127.0.0.1 \
          --port=19400 \
          --accept-paths=^/api/v1/namespaces/gpu-telemetry/services/http:dcgm-exporter:9400/proxy/(health|metrics)$
      '';
      Restart = "on-failure";
      RestartSec = "5s";
      PrivateTmp = true;
      ProtectHome = true;
      ProtectSystem = "strict";
    };
  };

  systemd.services.vector-development-gpu-health = {
    description = "Publish Vector GPU health signals to Netdata";
    after = [
      "k3s.service"
      "netdata.service"
      "vector-development-dcgm-proxy.service"
    ];
    wants = [
      "netdata.service"
      "vector-development-dcgm-proxy.service"
    ];
    serviceConfig = {
      CapabilityBoundingSet = "";
      ExecStart = "${gpuHealthCollector}/bin/vector-development-gpu-health";
      NoNewPrivileges = true;
      PrivateDevices = true;
      PrivateTmp = true;
      ProtectControlGroups = true;
      ProtectHome = true;
      ProtectKernelModules = true;
      ProtectKernelTunables = true;
      ProtectSystem = "strict";
      RestrictAddressFamilies = [
        "AF_INET"
        "AF_INET6"
        "AF_UNIX"
      ];
      Type = "oneshot";
    };
  };

  systemd.timers.vector-development-gpu-health = {
    description = "Refresh Vector GPU health signals";
    wantedBy = [ "timers.target" ];
    timerConfig = {
      OnBootSec = "30s";
      OnUnitInactiveSec = "15s";
      Unit = "vector-development-gpu-health.service";
    };
  };

  systemd.services.opentelemetry-collector = {
    description = "Route Vector GPU metrics to the local infrastructure metrics backend";
    after = [
      "netdata.service"
      "vector-development-dcgm-proxy.service"
    ];
    requires = [ "vector-development-dcgm-proxy.service" ];
    wants = [ "netdata.service" ];
    wantedBy = [ "multi-user.target" ];
    restartTriggers = [ ./opentelemetry-collector.yaml ];
    serviceConfig = {
      DynamicUser = true;
      ExecStart = "${pkgs.opentelemetry-collector-contrib}/bin/otelcol-contrib --config=/etc/opentelemetry-collector/config.yaml";
      Restart = "on-failure";
      RestartSec = "5s";
      MemoryHigh = "112M";
      MemoryMax = "128M";
      NoNewPrivileges = true;
      PrivateDevices = true;
      PrivateTmp = true;
      ProtectControlGroups = true;
      ProtectHome = true;
      ProtectKernelModules = true;
      ProtectKernelTunables = true;
      ProtectSystem = "strict";
      RestrictAddressFamilies = [
        "AF_INET"
        "AF_INET6"
        "AF_UNIX"
      ];
    };
  };

  systemd.services.t3-code-tailscale-serve = {
    description = "Publish vector-development T3 Code to the tailnet";
    after = [
      "k3s.service"
      "tailscaled.service"
    ];
    wants = [
      "k3s.service"
      "tailscaled.service"
    ];
    wantedBy = [ "multi-user.target" ];
    serviceConfig = {
      ExecStart = "${tailscaleServeScript}/bin/vector-development-tailscale-serve";
      Type = "oneshot";
      RemainAfterExit = true;
      Restart = "on-failure";
      RestartSec = "30s";
    };
  };

  time.timeZone = "Europe/London";
  i18n.defaultLocale = "en_GB.UTF-8";
}
