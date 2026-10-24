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
    displayManager.gdm.enable = true;
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
    printing.enable = true;
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
      chromium
      curl
      e2fsprogs
      firefox
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
      neovim
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

  systemd.services.vector-development-data-layout = {
    description = "Create vector-development data directories";
    wantedBy = [ "multi-user.target" ];
    before = [ "k3s.service" ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
    };
    script = ''
      install -d -m 0755 ${dataMount}
      install -d -m 2770 -o t3code -g t3code ${operatorDataPath}
      install -d -m 0750 -o t3code -g t3code ${operatorDataPath}/home
      install -d -m 0700 -o t3code -g t3code ${operatorDataPath}/home/.t3
      install -d -m 0700 -o t3code -g t3code ${operatorDataPath}/home/.codex
      install -d -m 0700 -o t3code -g t3code ${operatorDataPath}/home/.codex-personal
      install -d -m 0750 -o t3code -g t3code ${operatorDataPath}/workspaces
      install -d -m 2770 -o t3code -g t3code ${cacheDataPath}
      install -d -m 0750 -o t3code -g t3code ${cacheDataPath}/home-cache
      install -d -m 0750 -o t3code -g t3code ${cacheDataPath}/mise
      install -d -m 0750 -o t3code -g t3code ${cacheDataPath}/pnpm
      install -d -m 0750 -o t3code -g t3code ${cacheDataPath}/arduino15
      install -d -m 0750 -o t3code -g t3code ${cacheDataPath}/shared-task-cache
    '';
  };

  systemd.services.vector-development-project-quotas = {
    description = "Apply vector-development project quotas";
    after = [ "vector-development-data-layout.service" ];
    requires = [ "vector-development-data-layout.service" ];
    before = [ "k3s.service" ];
    wantedBy = [ "multi-user.target" ];
    path = with pkgs; [
      coreutils
      e2fsprogs
      findutils
      gawk
      gnugrep
      quota
      util-linux
    ];
    serviceConfig = {
      Type = "oneshot";
      RemainAfterExit = true;
      StateDirectory = "vector-development";
      StateDirectoryMode = "0700";
    };
    script = ''
      findmnt --noheadings --output OPTIONS / | tr ',' '\n' | grep -Fx prjquota >/dev/null
      if ! quotaon --project --print-state / | grep -F ' is on' >/dev/null; then
        quotaon --project /
      fi

      quota_state="${projectQuotaLayoutVersion}:$(findmnt --noheadings --output UUID / | tr -d ' ')"
      quota_state_file=/var/lib/vector-development/project-quota-layout
      if [ "$(cat "$quota_state_file" 2>/dev/null || true)" != "$quota_state" ]; then
        find ${operatorDataPath} -xdev ! -type l -exec chattr -p ${operatorProjectId} {} +
        find ${cacheDataPath} -xdev ! -type l -exec chattr -p ${cacheProjectId} {} +
      fi
      chattr +P ${operatorDataPath}
      setquota --project ${operatorProjectId} 0 ${operatorBlockHardLimit} 0 ${operatorInodeHardLimit} /
      chattr +P ${cacheDataPath}
      setquota --project ${cacheProjectId} 0 ${cacheBlockHardLimit} 0 ${cacheInodeHardLimit} /
      repquota --project --verbose --no-names --output=csv / | awk -F, '
        $1 == "#${operatorProjectId}" {
          operator_found = 1
          if ($6 != "${operatorBlockHardLimitKiB}" || $10 != "${operatorInodeHardLimit}") exit 1
        }
        $1 == "#${cacheProjectId}" {
          cache_found = 1
          if ($6 != "${cacheBlockHardLimitKiB}" || $10 != "${cacheInodeHardLimit}") exit 1
        }
        END { if (!operator_found || !cache_found) exit 1 }'
      quota_state_tmp="$(mktemp "$quota_state_file.XXXXXX")"
      trap 'rm -f -- "$quota_state_tmp"' EXIT
      printf '%s\n' "$quota_state" >"$quota_state_tmp"
      chmod 0600 "$quota_state_tmp"
      mv -f -- "$quota_state_tmp" "$quota_state_file"
      trap - EXIT
    '';
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
    path = [ nvidiaContainerTools ];
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
    path = [
      pkgs.jq
      pkgs.tailscale
    ];
    script = ''
      if tailscale status --json | jq --exit-status '.BackendState == "Running"' >/dev/null; then
        tailscale serve reset
        tailscale serve --bg --https=443 http://127.0.0.1:30773
        tailscale serve --bg --https=3000 http://127.0.0.1:31000
        tailscale serve --bg --https=3001 http://127.0.0.1:31001
        tailscale serve --bg --https=3002 http://127.0.0.1:31002
        tailscale serve --bg --https=3003 http://127.0.0.1:31003
        tailscale serve --bg --https=3004 http://127.0.0.1:31004
      else
        echo "Tailscale is not enrolled; Serve will be configured after enrollment"
      fi
    '';
    serviceConfig = {
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
