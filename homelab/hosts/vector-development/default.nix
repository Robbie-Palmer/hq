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
  t3CodeDesktop = pkgs.callPackage ../../packages/t3-code-desktop.nix { };
  nvidiaContainerTools = lib.getOutput "tools" config.hardware.nvidia-container-toolkit.package;
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
in
{
  imports = [
    ./disk-config.nix
    ./hardware-configuration.nix
  ];

  networking = {
    hostName = "vector-development";
    networkmanager.enable = true;
    firewall = {
      enable = true;
      checkReversePath = "loose";
      allowedUDPPorts = [ config.services.tailscale.port ];
      trustedInterfaces = [
        "cni0"
        "tailscale0"
      ];
    };
  };

  boot = {
    loader.systemd-boot = {
      enable = true;
      configurationLimit = 10;
    };
    loader.efi.canTouchEfiVariables = true;
    tmp.cleanOnBoot = true;
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
    openssh = {
      enable = true;
      openFirewall = true;
      settings = {
        AllowUsers = [
          "root"
          "robbie"
        ];
        KbdInteractiveAuthentication = false;
        PasswordAuthentication = false;
        PermitRootLogin = "prohibit-password";
        X11Forwarding = false;
      };
    };
    tailscale = {
      enable = true;
      extraSetFlags = [ "--ssh" ];
    };
    k3s = {
      enable = true;
      role = "server";
      nodeName = "vector-development";
      nodeLabel = [
        "homelab.dev/location=home"
        "homelab.dev/capability=agent-workspace"
        "homelab.dev/power-profile=mains-dependent"
        "homelab.dev/accelerator=nvidia"
      ];
      disable = [
        "servicelb"
        "traefik"
      ];
      extraFlags = [
        "--kubelet-arg=node-ip=0.0.0.0"
        "--secrets-encryption"
        "--write-kubeconfig-mode=0640"
      ];
      gracefulNodeShutdown.enable = true;
      extraKubeletConfig = {
        containerLogMaxFiles = 3;
        containerLogMaxSize = "20Mi";
        failSwapOn = false;
        memorySwap.swapBehavior = "NoSwap";
        systemReserved = {
          cpu = "2";
          memory = "4Gi";
        };
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
    rtkit.enable = true;
    sudo.wheelNeedsPassword = true;
  };

  users = {
    mutableUsers = true;
    groups.t3code.gid = 2000;
    users = {
      root.openssh.authorizedKeys.keys = operatorKeys;
      robbie = {
        isNormalUser = true;
        uid = 1000;
        description = "Robbie Palmer";
        extraGroups = [
          "docker"
          "networkmanager"
          "video"
          "wheel"
        ];
        openssh.authorizedKeys.keys = operatorKeys;
      };
      t3code = {
        isSystemUser = true;
        uid = 2000;
        group = "t3code";
        home = "${operatorDataPath}/home";
        createHome = false;
      };
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
      "nvidia-container-runtime/config.toml".text = ''
        disable-require = true
        supported-driver-capabilities = "compat32,compute,display,graphics,ngx,utility,video"
        [nvidia-container-cli]
        environment = []
        ldconfig = "@${lib.getExe' pkgs.glibc "ldconfig"}"
        load-kmods = true
        no-cgroups = false
        path = "${lib.getExe' pkgs.libnvidia-container "nvidia-container-cli"}"
        [nvidia-container-runtime]
        mode = "cdi"
        runtimes = ["${lib.getExe pkgs.runc}"]
        [nvidia-container-runtime-hook]
        path = "${nvidiaContainerTools}/bin/nvidia-container-runtime-hook"
        skip-mode-detection = false
        [nvidia-ctk]
        path = "${lib.getExe' config.hardware.nvidia-container-toolkit.package "nvidia-ctk"}"
      '';
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
      git
      gh
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

  system.activationScripts.vectorDevelopmentRefreshGnomePower = lib.stringAfter
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

  systemd.services.k3s = {
    after = [
      "nvidia-container-toolkit-cdi-generator.service"
      "vector-development-data-layout.service"
      "vector-development-project-quotas.service"
    ];
    wants = [ "nvidia-container-toolkit-cdi-generator.service" ];
    requires = [
      "vector-development-data-layout.service"
      "vector-development-project-quotas.service"
    ];
    path = [
      nvidiaContainerTools
      pkgs.runc
    ];
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

  nix = {
    settings = {
      experimental-features = [
        "nix-command"
        "flakes"
      ];
      auto-optimise-store = true;
    };
    gc = {
      automatic = true;
      dates = "Sun 04:15";
      options = "--delete-older-than 30d";
    };
  };

  system.autoUpgrade.enable = false;
  time.timeZone = "Europe/London";
  i18n.defaultLocale = "en_GB.UTF-8";
  system.stateVersion = "26.05";
}
