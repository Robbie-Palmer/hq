{
  config,
  lib,
  ...
}:

let
  cfg = config.homelab.hostLifecycle;
  inherit (lib)
    mkEnableOption
    mkIf
    mkOption
    types
    ;
  cacheSubstituters = map (cache: cache.url) cfg.binaryCaches;
  cachePublicKeys = map (cache: cache.publicKey) cfg.binaryCaches;
in
{
  options.homelab.hostLifecycle = {
    enable = mkEnableOption "the shared NixOS host lifecycle contract";

    profile = mkOption {
      type = types.enum [
        "hardware"
        "vm"
      ];
      description = "Hardware ownership profile used by the provisioning and recovery runbook.";
    };

    hostName = mkOption {
      type = types.strMatching "[a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?";
      description = "Stable host identity shared by NixOS, K3s, backups, and monitoring.";
    };

    stateVersion = mkOption {
      type = types.str;
      description = "NixOS state version chosen when the host was first installed.";
    };

    operator = {
      name = mkOption {
        type = types.str;
        default = "robbie";
        description = "Named human operator account.";
      };

      uid = mkOption {
        type = types.int;
        default = 1000;
        description = "Stable numeric ID for the operator account.";
      };

      description = mkOption {
        type = types.str;
        default = "Robbie Palmer";
        description = "GECOS description for the operator account.";
      };

      authorizedKeys = mkOption {
        type = types.listOf types.str;
        description = "Public SSH keys accepted for the operator and recovery root login.";
      };

      extraGroups = mkOption {
        type = types.listOf types.str;
        default = [ "wheel" ];
        description = "Supplementary groups assigned to the operator account.";
      };

      mutablePassword = mkOption {
        type = types.bool;
        default = false;
        description = "Whether the physical console may manage the operator password outside Nix.";
      };

      wheelNeedsPassword = mkOption {
        type = types.bool;
        default = false;
        description = "Whether sudo requires the operator's local password.";
      };
    };

    ssh.openFirewall = mkOption {
      type = types.bool;
      default = true;
      description = "Whether the NixOS firewall opens SSH. Provider firewalls remain a separate gate.";
    };

    firewall.trustedInterfaces = mkOption {
      type = types.listOf types.str;
      default = [
        "cni0"
        "tailscale0"
      ];
      description = "Host interfaces trusted for cluster and tailnet traffic.";
    };

    k3s = {
      enable = mkOption {
        type = types.bool;
        default = true;
        description = "Install the single-node K3s control plane and its containerd runtime.";
      };

      nodeLabels = mkOption {
        type = types.listOf types.str;
        default = [ ];
        description = "Scheduling labels that describe location, capability, and power profile.";
      };

      extraFlags = mkOption {
        type = types.listOf types.str;
        default = [ ];
        description = "Host-specific K3s flags added to the shared security baseline.";
      };

      extraKubeletConfig = mkOption {
        type = types.attrs;
        default = { };
        description = "Host-specific kubelet settings merged with the shared log and swap policy.";
      };
    };

    requiredMounts = mkOption {
      type = types.listOf types.str;
      default = [ "/" ];
      description = "Filesystems that must be declared before a host configuration can build.";
    };

    secretBootstrapPaths = mkOption {
      type = types.listOf types.str;
      default = [ ];
      description = "Runtime paths populated out of band. Values must never enter Nix evaluation.";
    };

    binaryCaches = mkOption {
      default = [ ];
      description = "Additional signed binary caches used by this host.";
      type = types.listOf (
        types.submodule {
          options = {
            url = mkOption {
              type = types.strMatching "https://.+";
              description = "HTTPS substituter URL.";
            };
            publicKey = mkOption {
              type = types.strMatching ".+:[A-Za-z0-9+/=]+";
              description = "Public signing key for the substituter.";
            };
          };
        }
      );
    };
  };

  config = mkIf cfg.enable {
    assertions = [
      {
        assertion = config.system.configurationRevision != null;
        message = "Lifecycle-managed hosts must record the flake configuration revision.";
      }
      {
        assertion = lib.all (path: lib.hasPrefix "/" path) cfg.requiredMounts;
        message = "Every required mount must be an absolute path.";
      }
      {
        assertion = lib.all (path: builtins.hasAttr path config.fileSystems) cfg.requiredMounts;
        message = "Every homelab.hostLifecycle.requiredMounts entry must exist in fileSystems.";
      }
      {
        assertion = lib.all (
          path: lib.hasPrefix "/" path && !(lib.hasPrefix "/nix/store/" path)
        ) cfg.secretBootstrapPaths;
        message = "Secret bootstrap paths must be absolute runtime paths outside /nix/store.";
      }
      {
        assertion = lib.all (label: builtins.match "[^=]+=[^=]+" label != null) cfg.k3s.nodeLabels;
        message = "Every K3s node label must use key=value form.";
      }
      {
        assertion = builtins.length cfg.k3s.nodeLabels == builtins.length (lib.unique cfg.k3s.nodeLabels);
        message = "K3s node labels must be unique.";
      }
      {
        assertion = cfg.operator.authorizedKeys != [ ];
        message = "Lifecycle-managed hosts require at least one operator SSH public key.";
      }
    ];

    networking = {
      inherit (cfg) hostName;
      firewall = {
        enable = true;
        checkReversePath = "loose";
        allowedUDPPorts = [ config.services.tailscale.port ];
        trustedInterfaces = cfg.firewall.trustedInterfaces;
      };
    };

    boot = {
      loader.grub.configurationLimit = 10;
      loader.systemd-boot.configurationLimit = 10;
      tmp.cleanOnBoot = true;
    };

    users = {
      mutableUsers = cfg.operator.mutablePassword;
      users = {
        root.openssh.authorizedKeys.keys = cfg.operator.authorizedKeys;
        ${cfg.operator.name} = {
          isNormalUser = true;
          inherit (cfg.operator) uid description extraGroups;
          openssh.authorizedKeys.keys = cfg.operator.authorizedKeys;
        };
      };
    };

    security.sudo.wheelNeedsPassword = cfg.operator.wheelNeedsPassword;

    services = {
      openssh = {
        enable = true;
        openFirewall = cfg.ssh.openFirewall;
        settings = {
          AllowUsers = [
            "root"
            cfg.operator.name
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

      k3s = mkIf cfg.k3s.enable {
        enable = true;
        role = "server";
        nodeName = cfg.hostName;
        nodeLabel = cfg.k3s.nodeLabels;
        disable = [
          "servicelb"
          "traefik"
        ];
        extraFlags = [
          "--secrets-encryption"
          "--write-kubeconfig-mode=0640"
        ] ++ cfg.k3s.extraFlags;
        gracefulNodeShutdown.enable = true;
        extraKubeletConfig = {
          containerLogMaxFiles = 3;
          containerLogMaxSize = "20Mi";
          failSwapOn = false;
          memorySwap.swapBehavior = "NoSwap";
        } // cfg.k3s.extraKubeletConfig;
      };
    };

    nix = {
      settings = {
        experimental-features = [
          "nix-command"
          "flakes"
        ];
        auto-optimise-store = true;
      }
      // lib.optionalAttrs (cfg.binaryCaches != [ ]) {
        extra-substituters = cacheSubstituters;
        extra-trusted-public-keys = cachePublicKeys;
      };
      gc = {
        automatic = true;
        dates = "Sun 04:15";
        options = "--delete-older-than 30d";
      };
    };

    system = {
      autoUpgrade.enable = false;
      inherit (cfg) stateVersion;
    };
  };
}
