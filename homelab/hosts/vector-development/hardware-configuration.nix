{
  lib,
  modulesPath,
  ...
}:

{
  imports = [ "${modulesPath}/installer/scan/not-detected.nix" ];

  boot.initrd.availableKernelModules = [
    "nvme"
    "r8169"
    "thunderbolt"
    "vmd"
    "xhci_pci"
  ];
  # The quota-enabled root filesystem is mounted in stage 1, before the full
  # kernel module tree is available.
  boot.initrd.kernelModules = [ "quota_v2" ];
  boot.kernelModules = [ "kvm-intel" ];
  boot.extraModulePackages = [ ];

  hardware.cpu.intel.updateMicrocode = lib.mkDefault true;
  networking.useDHCP = lib.mkDefault true;
  nixpkgs.hostPlatform = lib.mkDefault "x86_64-linux";
}
