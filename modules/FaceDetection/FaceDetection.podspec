require "json"

package = JSON.parse(File.read(File.join(__dir__, "package.json")))

Pod::Spec.new do |s|
  s.name         = "FaceDetection"
  s.version      = package["version"]
  s.summary      = "Nitro Face Detection frame processor"
  s.homepage     = "https://example.local/face-detection"
  s.license      = "MIT"
  s.authors      = "poc-facescan"

  s.platforms    = { :ios => min_ios_version_supported, :visionos => 1.0 }
  s.source       = { :git => "https://example.local/face-detection", :tag => "#{s.version}" }

  s.source_files = [
    "ios/**/*.{swift,m,mm}",
    "cpp/**/*.{hpp,cpp}",
  ]
  s.frameworks = ["Vision", "CoreMedia", "CoreImage", "UIKit"]

  load 'nitrogen/generated/ios/FaceDetection+autolinking.rb'
  add_nitrogen_files(s)

  s.dependency 'React-jsi'
  s.dependency 'React-callinvoker'
  s.dependency 'VisionCamera'
  install_modules_dependencies(s)
end
